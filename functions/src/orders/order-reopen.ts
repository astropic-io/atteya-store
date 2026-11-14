import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { RequiredCaller } from '../auth/require-role.js';
import { shortOrderRef } from '../email/order-email-model.js';
import { readSizeValueIds } from '../products/stock.js';
import { timestampMs } from '../store/returns.js';
import { parseSavedOfferUses, readOfferRetake } from './offer-usage.js';
import { orderStaffNotesRef, staffNotesPatch } from './order-staff-notes.js';
import { readStockPlan, takeStock, type StockPlanItem } from './order-status-change.js';
import {
  orderStockTaken,
  reopenRefusal,
  statusBeforeCancel,
  type ReopenStatus,
  type StatusHistoryFacts,
} from '../store/order-status.js';

export interface ReopenOrderResult {
  readonly orderId: string;
  /** The status the order went back to (the one it had before the cancel). */
  readonly status: ReopenStatus;
  /** `take`: items left stock again; `none`: stock untouched (Waiting for Payment). */
  readonly stock: 'take' | 'none';
}

/** The `reason` on the history row a reopen adds. */
export const REOPEN_HISTORY_REASON = 'Reopened';

/**
 * Reopen Order (ATS-325): puts a cancelled order back to the status it had before the cancel, in
 * one transaction against the live order. Refuses Payment Failed, Card (Paymob) and orders
 * cancelled more than 7 days ago (`reopenRefusal`). The status before the cancel comes from
 * `orderStaffNotes.statusHistory` (`statusBeforeCancel`). Back to Confirmed takes the stock again
 * (the same code as Confirmed), refusing with the item named when one is short. The offer uses
 * the cancel gave back are counted again (`readOfferRetake`). `cancelledAt` / `cancelledBy` are
 * cleared, `reopenedAt` is stamped (the shopper's "back on" email is claimed per reopen on it),
 * and a history row `{ status, from: 'cancelled', reason: 'Reopened' }` is added.
 */
export async function reopenOrder(
  db: Firestore,
  orderId: string,
  actor: RequiredCaller,
  nowMs: number = Date.now(),
): Promise<ReopenOrderResult> {
  const orderRef = db.collection('orders').doc(orderId);
  const notesRef = orderStaffNotesRef(db, orderId);

  return db.runTransaction(async (tx) => {
    const [snap, notesSnap] = await Promise.all([tx.get(orderRef), tx.get(notesRef)]);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'That order could not be found.');
    }
    const order: DocumentData = snap.data() ?? {};
    const refusal = reopenRefusal(
      {
        status: order['status'],
        paymentMethod: order['paymentMethod'],
        cancelledAtMs: timestampMs(order['cancelledAt']),
      },
      nowMs,
    );
    if (refusal) throw new HttpsError('failed-precondition', refusal);

    const notes: DocumentData = notesSnap.exists ? (notesSnap.data() ?? {}) : {};
    const history = Array.isArray(notes['statusHistory'])
      ? (notes['statusHistory'] as StatusHistoryFacts[]).filter(isRecord)
      : [];
    const target = statusBeforeCancel(history);
    if (!target) {
      throw new HttpsError(
        'failed-precondition',
        "We can't tell what this order's status was before it was cancelled, so it can't be reopened. Ask the shopper to order again.",
      );
    }

    // Confirmed holds stock; a cancel put it back, so it is taken again (never twice).
    const takesStock = target === 'confirmed' && !orderStockTaken(order);
    // Pieces the cancel couldn't put back are still out of stock: taking the whole order again
    // would count them out twice.
    if (takesStock && wholeCount(order['stockNotReturned']) > 0) {
      throw new HttpsError(
        'failed-precondition',
        "Some items on this order didn't go back into stock when it was cancelled, so it can't be reopened here. Ask the shopper to order again.",
      );
    }
    let stockPlan: StockPlanItem[] | null = null;
    if (takesStock) {
      stockPlan = await readStockPlan(tx, db, order);
      const short = stockShortage(order, stockPlan);
      if (short) {
        throw new HttpsError(
          'failed-precondition',
          `Can't reopen ${shortOrderRef(orderId)}: ${short.item} has only ${short.left} left. Add stock first, or ask the shopper to order again.`,
        );
      }
    }

    const saved = order['offerUsesReturnedAt'] ? parseSavedOfferUses(order['offerUses']) : null;
    const retake = saved ? await readOfferRetake(tx, db, saved) : null;

    // Every read is done; writes from here on.
    const now = FieldValue.serverTimestamp();
    if (stockPlan) {
      for (const item of stockPlan) {
        const next = takeStock(item.data, item.demand);
        tx.update(item.ref, {
          stock: next.stock,
          inStock: next.inStock,
          stockBySize: next.stockBySize ?? FieldValue.delete(),
          updatedAt: now,
          updatedBy: actor.uid,
        });
      }
    }
    retake?.();

    tx.set(
      notesRef,
      staffNotesPatch(
        {
          status: target,
          from: 'cancelled',
          at: Timestamp.fromMillis(nowMs),
          by: actor.uid,
          ...(actor.email ? { byEmail: actor.email } : {}),
          reason: REOPEN_HISTORY_REASON,
        },
        // The cancel reason belonged to the cancel; its history row keeps it.
        null,
      ),
      { merge: true },
    );

    const patch: DocumentData = {
      status: target,
      updatedAt: now,
      cancelledAt: null,
      cancelledBy: null,
      reopenedAt: now,
      reopenedBy: actor.uid,
    };
    if (Object.hasOwn(order, 'cancelReason')) patch['cancelReason'] = null;
    if (retake) patch['offerUsesReturnedAt'] = null;
    if (takesStock) {
      patch['stockDecrementedAt'] = now;
      patch['stockReturnedAt'] = null;
      patch['stockNotReturned'] = FieldValue.delete();
    }
    if (target === 'confirmed' && !order['confirmedAt']) patch['confirmedAt'] = now;
    tx.update(orderRef, patch);

    return { orderId, status: target, stock: takesStock ? ('take' as const) : ('none' as const) };
  });
}

interface StockShortage {
  /** "Linen Shirt (M / Black)". */
  readonly item: string;
  readonly left: number;
}

/**
 * The first order item whose live stock is below what the order needs, named for the refusal.
 * Only plain shortages are named here; any other stock problem (a size removed, stock not set up,
 * a deleted product) is refused by `takeStock` with its own message.
 */
export function stockShortage(
  order: Readonly<Record<string, unknown>>,
  plan: readonly StockPlanItem[],
): StockShortage | null {
  const lines = savedLines(order);
  for (const item of plan) {
    if (!item.data) continue;
    const productId = item.ref.id;
    const map = isRecord(item.data['stockBySize']) ? item.data['stockBySize'] : null;
    if (item.demand.kind === 'sized' && map) {
      for (const [sizeId, qty] of Object.entries(item.demand.bySize)) {
        // A size the product's size option no longer has: `takeStock` refuses with its own message.
        if (!Object.hasOwn(map, sizeId) && readSizeValueIds(item.data['options']).length > 0) continue;
        const left = wholeCount(map[sizeId]);
        if (left < qty) return { item: itemName(lines, item.data, productId, sizeId), left };
      }
    } else if (item.demand.kind === 'flat' && !map && typeof item.data['stock'] === 'number') {
      const left = wholeCount(item.data['stock']);
      if (left < item.demand.quantity) return { item: itemName(lines, item.data, productId, null), left };
    }
  }
  return null;
}

interface SavedLine {
  readonly productId: string;
  readonly sizeId: string | null;
  readonly name: string;
  readonly options: string;
}

function savedLines(order: Readonly<Record<string, unknown>>): SavedLine[] {
  const pricing = isRecord(order['pricing']) ? order['pricing'] : null;
  const raw = pricing && Array.isArray(pricing['lines']) ? pricing['lines'] : [];
  return raw.filter(isRecord).map((line) => {
    const selection = isRecord(line['selection']) ? line['selection'] : {};
    const labels = Array.isArray(line['optionLabels']) ? line['optionLabels'].filter(isRecord) : [];
    const options = labels
      .map((entry) => (typeof entry['value'] === 'string' ? entry['value'].trim() : ''))
      .filter(Boolean)
      .join(' / ');
    return {
      productId: typeof line['productId'] === 'string' ? line['productId'] : '',
      sizeId: typeof selection['size'] === 'string' ? selection['size'] : null,
      name: typeof line['name'] === 'string' ? line['name'].trim() : '',
      options,
    };
  });
}

function itemName(
  lines: readonly SavedLine[],
  product: DocumentData,
  productId: string,
  sizeId: string | null,
): string {
  const line =
    lines.find((entry) => entry.productId === productId && entry.sizeId === sizeId) ??
    lines.find((entry) => entry.productId === productId);
  const productName = typeof product['name'] === 'string' ? product['name'].trim() : '';
  const name = line?.name || productName || 'One item';
  const options = line?.options || (sizeId ? sizeLabel(product, sizeId) : '');
  return options ? `${name} (${options})` : name;
}

function sizeLabel(product: DocumentData, sizeId: string): string {
  const options = Array.isArray(product['options']) ? product['options'].filter(isRecord) : [];
  const size = options.find((option) => option['key'] === 'size');
  const values = size && Array.isArray(size['values']) ? size['values'].filter(isRecord) : [];
  const value = values.find((entry) => entry['id'] === sizeId);
  return value && typeof value['label'] === 'string' ? value['label'] : sizeId;
}

function wholeCount(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
