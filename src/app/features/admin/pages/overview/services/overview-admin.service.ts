import { Service } from '@angular/core';
import {
  collection,
  documentId,
  getAggregateFromServer,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  sum,
  Timestamp,
  where,
  type Query,
} from 'firebase/firestore';
import * as v from 'valibot';
import { injectFirestore } from '@core/firebase';
import { OFFERS_COLLECTION } from '@core/services/offers/offer.model';
import { ORDERS_COLLECTION } from '@core/services/orders/order.schema';
import { normalizeImageKitPath } from '@shared/utils/image';
import { MAX_RANGE_DAYS, type DayRange } from '../utils/overview-range.utils';
import {
  DayCountsSchema,
  DayMoneySchema,
  STORE_STATS_COLLECTION,
  STORE_STATS_MONEY_COLLECTION,
  type DayCounts,
  type DayMoney,
} from '../utils/overview-stats.utils';

/** Products at or below this many pieces count as running low (the Products list uses the same). */
export const OVERVIEW_LOW_STOCK = 5;
/** Confirmed orders older than this many days and not yet shipped need a look. */
export const CONFIRMED_LATE_DAYS = 2;
/** Most active offers read for the Offers box (only a handful are ever active at once). */
const RUNNING_OFFERS_MAX = 100;

export interface OverviewDays {
  readonly counts: ReadonlyMap<string, DayCounts>;
  /** Null for staff: pounds are admin only. */
  readonly money: ReadonlyMap<string, DayMoney> | null;
}

/** The live boxes (not affected by the date range). A number that failed to load is null. */
export interface OverviewLive {
  readonly waitingForPayment: number | null;
  readonly confirmedLate: number | null;
  readonly openReturns: number | null;
  readonly refundsToSend: number | null;
  /** Refunds owed for items staff cancelled before delivery, summed over orders (<KEY>-345). */
  readonly itemRefundsToSend: number | null;
  readonly productsLive: number | null;
  readonly productsHidden: number | null;
  readonly outOfStock: number | null;
  readonly runningLow: number | null;
  readonly offersRunning: number | null;
  /** Days until the soonest running offer ends; null when none has an end date. */
  readonly offerEndsInDays: number | null;
}

/** Most products shown in the low stock list (View All opens the full list). */
export const LOW_STOCK_LIST_MAX = 5;

/** A product for the low stock list or a best seller photo. */
export interface OverviewProduct {
  readonly id: string;
  readonly name: string;
  readonly stock: number | null;
  /** First gallery photo, ready for `[ngSrc]`; null when the product has none. */
  readonly imagePath: string | null;
}

/** The few product fields the Overview reads (the full product schema isn't needed here). */
const OverviewProductSchema = v.object({
  name: v.fallback(v.string(), ''),
  stock: v.fallback(v.nullable(v.pipe(v.number(), v.finite())), null),
  images: v.fallback(v.array(v.object({ path: v.fallback(v.string(), '') })), []),
});

function toOverviewProduct(id: string, data: unknown): OverviewProduct | null {
  const parsed = v.safeParse(OverviewProductSchema, data);
  if (!parsed.success) return null;
  const path = parsed.output.images.find((image) => image.path)?.path;
  return {
    id,
    name: parsed.output.name,
    stock: parsed.output.stock,
    imagePath: path ? normalizeImageKitPath(path) : null,
  };
}

const settled = <T>(promise: Promise<T>): Promise<T | null> => promise.catch(() => null);

/** Reads the admin Overview (ATS-340): the daily summaries for a range, and the live counts. */
@Service()
export class OverviewAdminService {
  readonly #firestore = injectFirestore();

  /**
   * Every saved day from `range.from` to `range.to` (one query; days with nothing are missing).
   * `withMoney` reads the admin-only pounds as well.
   */
  async days(range: DayRange, withMoney: boolean): Promise<OverviewDays> {
    const read = async <T>(name: string, schema: v.GenericSchema<unknown, T>): Promise<Map<string, T>> => {
      const snap = await getDocs(
        query(
          collection(this.#firestore, name),
          where(documentId(), '>=', range.from),
          where(documentId(), '<=', range.to),
          // The range and the one before it: never more than two longest ranges of days.
          limit(MAX_RANGE_DAYS * 2 + 2),
        ),
      );
      const out = new Map<string, T>();
      for (const item of snap.docs) {
        const parsed = v.safeParse(schema, { ...item.data(), day: item.id });
        if (parsed.success) out.set(item.id, parsed.output);
      }
      return out;
    };
    const [counts, money] = await Promise.all([
      read(STORE_STATS_COLLECTION, DayCountsSchema),
      withMoney ? read(STORE_STATS_MONEY_COLLECTION, DayMoneySchema) : Promise.resolve(null),
    ]);
    return { counts, money };
  }

  /** The live boxes. Each number is read on its own (a count costs one read per 1,000 docs). */
  async live(now: Date): Promise<OverviewLive> {
    const orders = collection(this.#firestore, ORDERS_COLLECTION);
    const returns = collection(this.#firestore, 'returnRequests');
    const products = collection(this.#firestore, 'products');
    const count = (q: Query) => settled(getCountFromServer(q).then((snap) => snap.data().count));
    const lateBefore = Timestamp.fromMillis(now.getTime() - CONFIRMED_LATE_DAYS * 24 * 60 * 60 * 1000);

    const [
      waitingForPayment,
      confirmedLate,
      openReturns,
      returnRefundsToSend,
      itemRefundsToSend,
      productsLive,
      productsHidden,
      outOfStock,
      runningLow,
      offers,
    ] = await Promise.all([
      count(query(orders, where('status', '==', 'pending'))),
      count(query(orders, where('status', '==', 'confirmed'), where('confirmedAt', '<', lateBefore))),
      count(query(returns, where('status', 'in', ['requested', 'waiting-for-payment', 'approved']))),
      count(query(returns, where('status', '==', 'received'), where('hasRefund', '==', true))),
      // Refunds owed for items staff cancelled before delivery: the sum, since one order can owe several.
      settled(
        getAggregateFromServer(query(orders, where('itemRefundsToSend', '>', 0)), {
          n: sum('itemRefundsToSend'),
        }).then((snap) => snap.data().n ?? 0),
      ),
      count(query(products, where('published', '==', true))),
      count(query(products, where('published', '==', false))),
      count(query(products, where('published', '==', true), where('stock', '<=', 0))),
      count(
        query(
          products,
          where('published', '==', true),
          where('stock', '>', 0),
          where('stock', '<=', OVERVIEW_LOW_STOCK),
        ),
      ),
      settled(this.#runningOffers(now)),
    ]);

    return {
      waitingForPayment,
      confirmedLate,
      openReturns:
        openReturns === null || returnRefundsToSend === null
          ? openReturns
          : openReturns + returnRefundsToSend,
      refundsToSend: returnRefundsToSend,
      itemRefundsToSend,
      productsLive,
      productsHidden,
      outOfStock,
      runningLow,
      offersRunning: offers?.running ?? null,
      offerEndsInDays: offers?.endsInDays ?? null,
    };
  }

  /** Active offers whose dates include now (only a handful are ever active, so they are read whole). */
  async #runningOffers(now: Date): Promise<{ running: number; endsInDays: number | null }> {
    const snap = await getDocs(
      query(
        collection(this.#firestore, OFFERS_COLLECTION),
        where('active', '==', true),
        limit(RUNNING_OFFERS_MAX),
      ),
    );
    const nowMs = now.getTime();
    let running = 0;
    let soonestEnd: number | null = null;
    for (const item of snap.docs) {
      if (item.get('archived') === true) continue;
      const startsAt = item.get('schedule.startsAt');
      const endsAt = item.get('schedule.endsAt');
      const startMs = startsAt instanceof Timestamp ? startsAt.toMillis() : null;
      const endMs = endsAt instanceof Timestamp ? endsAt.toMillis() : null;
      if (startMs !== null && startMs > nowMs) continue;
      if (endMs !== null && endMs <= nowMs) continue;
      running += 1;
      if (endMs !== null && (soonestEnd === null || endMs < soonestEnd)) soonestEnd = endMs;
    }
    const endsInDays =
      soonestEnd === null ? null : Math.max(0, Math.ceil((soonestEnd - nowMs) / (24 * 60 * 60 * 1000)));
    return { running, endsInDays };
  }

  /** Live products with 1 to 5 pieces left, fewest first (same index as the Running low count). */
  async lowStock(): Promise<OverviewProduct[]> {
    const snap = await getDocs(
      query(
        collection(this.#firestore, 'products'),
        where('published', '==', true),
        where('stock', '>', 0),
        where('stock', '<=', OVERVIEW_LOW_STOCK),
        orderBy('stock', 'asc'),
        limit(LOW_STOCK_LIST_MAX),
      ),
    );
    return snap.docs.flatMap((item) => toOverviewProduct(item.id, item.data()) ?? []);
  }

  /** Photos for the best sellers (at most 10 ids: one `in` query). Missing products are left out. */
  async products(ids: readonly string[]): Promise<ReadonlyMap<string, OverviewProduct>> {
    const wanted = [...new Set(ids)].filter(Boolean).slice(0, 10);
    if (!wanted.length) return new Map();
    const snap = await getDocs(
      query(collection(this.#firestore, 'products'), where(documentId(), 'in', wanted), limit(wanted.length)),
    );
    const out = new Map<string, OverviewProduct>();
    for (const item of snap.docs) {
      const product = toOverviewProduct(item.id, item.data());
      if (product) out.set(item.id, product);
    }
    return out;
  }
}
