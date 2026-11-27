import * as v from 'valibot';
import { daysOf, type DayRange } from './overview-range.utils';

/**
 * The daily summaries the admin Overview reads (ATS-340), written only by Cloud Functions
 * (functions/src/stats/store-stats.ts), and how a range of days adds up. Pure: no Angular, no
 * Firestore.
 */
export const STORE_STATS_COLLECTION = 'storeStats';
/** Pounds per day; Firestore rules let only admins read it. */
export const STORE_STATS_MONEY_COLLECTION = 'storeStatsMoney';

const count = v.fallback(v.pipe(v.number(), v.finite(), v.minValue(0)), 0);
const countMap = v.fallback(v.record(v.string(), count), {});

export const DayCountsSchema = v.object({
  day: v.string(),
  orders: count,
  failedOrders: count,
  byStatus: v.fallback(
    v.object({
      pending: count,
      confirmed: count,
      shipped: count,
      delivered: count,
      cancelled: count,
    }),
    { pending: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 },
  ),
  soldOrders: count,
  pieces: count,
  byPayment: countMap,
  byPlace: countMap,
  products: v.fallback(
    v.record(v.string(), v.object({ name: v.fallback(v.string(), ''), pieces: count })),
    {},
  ),
  returns: count,
  refundRequests: count,
  refundsSent: count,
});
export type DayCounts = v.InferOutput<typeof DayCountsSchema>;

export const DayMoneySchema = v.object({
  day: v.string(),
  receivedEgp: count,
  refundsEgp: count,
  productEgp: countMap,
});
export type DayMoney = v.InferOutput<typeof DayMoneySchema>;

export type OrderStatusKey = keyof DayCounts['byStatus'];

/** One range added up. Money fields are null when the viewer can't read pounds (staff). */
export interface RangeTotals {
  readonly orders: number;
  /** Payment Failed orders (not in `orders`). */
  readonly failedOrders: number;
  readonly soldOrders: number;
  readonly pieces: number;
  readonly delivered: number;
  readonly cancelled: number;
  readonly returns: number;
  readonly refundRequests: number;
  readonly refundsSent: number;
  readonly byStatus: Readonly<Record<OrderStatusKey, number>>;
  readonly byPayment: Readonly<Record<string, number>>;
  readonly byPlace: Readonly<Record<string, number>>;
  readonly products: Readonly<Record<string, { readonly name: string; readonly pieces: number }>>;
  readonly receivedEgp: number | null;
  readonly refundsEgp: number | null;
  /** Pounds received minus refunds sent. */
  readonly netEgp: number | null;
  readonly averageOrderEgp: number | null;
  readonly productEgp: Readonly<Record<string, number>> | null;
}

/** One day of the chart. */
export interface DayPoint {
  readonly day: string;
  readonly orders: number;
  readonly receivedEgp: number | null;
}

const add = (into: Record<string, number>, from: Readonly<Record<string, number>>) => {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value;
};

/** Adds up the days of `range`. `money` is null for staff. A day with no doc counts as zero. */
export function totalsFor(
  range: DayRange,
  counts: ReadonlyMap<string, DayCounts>,
  money: ReadonlyMap<string, DayMoney> | null,
): RangeTotals {
  const byStatus: Record<OrderStatusKey, number> = {
    pending: 0,
    confirmed: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
  };
  const byPayment: Record<string, number> = {};
  const byPlace: Record<string, number> = {};
  const products: Record<string, { name: string; pieces: number }> = {};
  const productEgp: Record<string, number> = {};
  let orders = 0;
  let failedOrders = 0;
  let soldOrders = 0;
  let pieces = 0;
  let returns = 0;
  let refundRequests = 0;
  let refundsSent = 0;
  let receivedEgp = 0;
  let refundsEgp = 0;

  for (const day of daysOf(range)) {
    const c = counts.get(day);
    if (c) {
      orders += c.orders;
      failedOrders += c.failedOrders;
      soldOrders += c.soldOrders;
      pieces += c.pieces;
      returns += c.returns;
      refundRequests += c.refundRequests;
      refundsSent += c.refundsSent;
      for (const key of Object.keys(byStatus) as OrderStatusKey[]) byStatus[key] += c.byStatus[key];
      add(byPayment, c.byPayment);
      add(byPlace, c.byPlace);
      for (const [id, product] of Object.entries(c.products)) {
        const saved = products[id] ?? { name: '', pieces: 0 };
        products[id] = { name: saved.name || product.name, pieces: saved.pieces + product.pieces };
      }
    }
    const m = money?.get(day);
    if (m) {
      receivedEgp += m.receivedEgp;
      refundsEgp += m.refundsEgp;
      add(productEgp, m.productEgp);
    }
  }

  const hasMoney = money !== null;
  return {
    orders,
    failedOrders,
    soldOrders,
    pieces,
    delivered: byStatus.delivered,
    cancelled: byStatus.cancelled,
    returns,
    refundRequests,
    refundsSent,
    byStatus,
    byPayment,
    byPlace,
    products,
    receivedEgp: hasMoney ? receivedEgp : null,
    refundsEgp: hasMoney ? refundsEgp : null,
    netEgp: hasMoney ? receivedEgp - refundsEgp : null,
    averageOrderEgp: hasMoney && soldOrders > 0 ? Math.round(receivedEgp / soldOrders) : null,
    productEgp: hasMoney ? productEgp : null,
  };
}

/** One point per day of `range` for the chart (days with no doc are zero). */
export function dayPoints(
  range: DayRange,
  counts: ReadonlyMap<string, DayCounts>,
  money: ReadonlyMap<string, DayMoney> | null,
): DayPoint[] {
  return daysOf(range).map((day) => ({
    day,
    orders: counts.get(day)?.orders ?? 0,
    receivedEgp: money ? (money.get(day)?.receivedEgp ?? 0) : null,
  }));
}

/** Orders lost: Cancelled plus Payment Failed. */
export function lostOrders(totals: Pick<RangeTotals, 'cancelled' | 'failedOrders'>): number {
  return totals.cancelled + totals.failedOrders;
}

/**
 * Lost orders as a percent of every order placed (Payment Failed included), to one decimal.
 * Null when nothing was placed.
 */
export function lostRate(totals: Pick<RangeTotals, 'orders' | 'cancelled' | 'failedOrders'>): number | null {
  const placed = totals.orders + totals.failedOrders;
  return placed > 0 ? Math.round((lostOrders(totals) / placed) * 1000) / 10 : null;
}

/** Key number tiles that have a trend line. */
export type TrendTileId =
  | 'received'
  | 'orders'
  | 'average'
  | 'pieces'
  | 'new'
  | 'delivered'
  | 'returns'
  | 'refunds'
  | 'cancelled'
  | 'failed'
  | 'lost'
  | 'lostRate';

/**
 * One value per day of `range` for a tile's trend line. Null for a pounds tile when the viewer
 * can't see money. A day with no doc is zero; a rate with nothing placed that day is zero.
 */
export function daySeries(
  id: TrendTileId,
  range: DayRange,
  counts: ReadonlyMap<string, DayCounts>,
  money: ReadonlyMap<string, DayMoney> | null,
): number[] | null {
  const needsMoney = id === 'received' || id === 'average' || id === 'refunds';
  if (needsMoney && !money) return null;
  return daysOf(range).map((day) => {
    const c = counts.get(day);
    const m = money?.get(day);
    const cancelled = c?.byStatus.cancelled ?? 0;
    const failed = c?.failedOrders ?? 0;
    switch (id) {
      case 'received':
        return (m?.receivedEgp ?? 0) - (m?.refundsEgp ?? 0);
      case 'orders':
        return c?.orders ?? 0;
      case 'average':
        return c && c.soldOrders > 0 ? Math.round((m?.receivedEgp ?? 0) / c.soldOrders) : 0;
      case 'pieces':
        return c?.pieces ?? 0;
      case 'new':
        return c?.byStatus.pending ?? 0;
      case 'delivered':
        return c?.byStatus.delivered ?? 0;
      case 'returns':
        return c?.returns ?? 0;
      case 'refunds':
        return m?.refundsEgp ?? 0;
      case 'cancelled':
        return cancelled;
      case 'failed':
        return failed;
      case 'lost':
        return cancelled + failed;
      case 'lostRate':
        return lostRate({ orders: c?.orders ?? 0, cancelled, failedOrders: failed }) ?? 0;
    }
  });
}

export type DeltaTone = 'good' | 'bad' | 'flat';

export interface Delta {
  readonly label: string;
  readonly tone: DeltaTone;
  /** Screen reader text, e.g. "Up 12% from the period before". */
  readonly description: string;
}

/**
 * Change from the period before. `lowerIsBetter` for Cancelled, Return requests and Refunds sent.
 * Null when there's nothing to compare (both periods zero, or a money figure staff can't see).
 */
export function deltaOf(now: number | null, before: number | null, lowerIsBetter = false): Delta | null {
  if (now === null || before === null) return null;
  if (now === 0 && before === 0) return null;
  if (before === 0) return { label: 'New', tone: 'flat', description: 'Nothing in the period before' };
  const change = ((now - before) / before) * 100;
  if (Math.abs(change) < 1) return { label: 'Same', tone: 'flat', description: 'Same as the period before' };
  const up = change > 0;
  const percent = Math.round(Math.abs(change));
  return {
    label: `${up ? '▲' : '▼'} ${percent}%`,
    tone: up !== lowerIsBetter ? 'good' : 'bad',
    description: `${up ? 'Up' : 'Down'} ${percent}% from the period before`,
  };
}

/** Change of a rate (a percent) from the period before, in percentage points. */
export function pointsDeltaOf(
  now: number | null,
  before: number | null,
  lowerIsBetter = false,
): Delta | null {
  if (now === null || before === null) return null;
  const change = Math.round((now - before) * 10) / 10;
  if (Math.abs(change) < 0.1)
    return { label: 'Same', tone: 'flat', description: 'Same as the period before' };
  const up = change > 0;
  const points = Math.abs(change);
  return {
    label: `${up ? '▲' : '▼'} ${points} pts`,
    tone: up !== lowerIsBetter ? 'good' : 'bad',
    description: `${up ? 'Up' : 'Down'} ${points} percentage points from the period before`,
  };
}

/** A share as a whole percent of `total` (0 when total is 0). */
export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export const PAYMENT_LABELS: Readonly<Record<string, string>> = {
  'cash-on-delivery': 'Cash on Delivery',
  instapay: 'InstaPay',
  paymob: 'Card',
  'bank-transfer': 'Bank Transfer',
};

export const STATUS_ROWS: readonly { readonly key: OrderStatusKey; readonly label: string }[] = [
  { key: 'pending', label: 'Waiting for Payment' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

export interface ShareRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly percent: number;
}

/** Biggest first; everything after `keep` rows is folded into one "Other" row. */
export function shareRows(
  map: Readonly<Record<string, number>>,
  labelOf: (key: string) => string,
  keep: number,
  otherLabel: string,
  lastKeys: readonly string[] = [],
): ShareRow[] {
  const total = Object.values(map).reduce((sum, value) => sum + value, 0);
  const entries = Object.entries(map)
    .filter(([key, value]) => value > 0 && !lastKeys.includes(key))
    .sort(([ak, a], [bk, b]) => b - a || ak.localeCompare(bk));
  const rows = entries.slice(0, keep).map(([key, value]) => ({
    key,
    label: labelOf(key),
    count: value,
    percent: percentOf(value, total),
  }));
  const rest = entries.slice(keep).reduce((sum, [, value]) => sum + value, 0);
  if (rest > 0)
    rows.push({ key: '__other', label: otherLabel, count: rest, percent: percentOf(rest, total) });
  for (const key of lastKeys) {
    const value = map[key] ?? 0;
    if (value > 0) rows.push({ key, label: labelOf(key), count: value, percent: percentOf(value, total) });
  }
  return rows;
}

export interface BestSeller {
  readonly id: string;
  /** Share of all pieces sold in the range, whole percent. */
  readonly percent: number;
  readonly name: string;
  readonly pieces: number;
  readonly egp: number | null;
}

/** Top products by pieces. */
export function bestSellers(totals: RangeTotals, keep = 5): BestSeller[] {
  return Object.entries(totals.products)
    .sort(([ak, a], [bk, b]) => b.pieces - a.pieces || ak.localeCompare(bk))
    .slice(0, keep)
    .map(([id, product]) => ({
      id,
      percent: percentOf(product.pieces, totals.pieces),
      name: product.name || 'Product',
      pieces: product.pieces,
      egp: totals.productEgp ? (totals.productEgp[id] ?? 0) : null,
    }));
}
