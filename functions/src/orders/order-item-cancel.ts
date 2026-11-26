import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { RequiredCaller } from '../auth/require-role.js';
import {
  itemCancelLabel,
  pieceFromLine,
  planItemCancel,
  type ItemCancelRequest,
  type ItemRefundSentRequest,
} from '../store/order-item-cancel.js';
import { orderStockTaken } from '../store/order-status.js';
import { aggregateOrderStockDemand, applyStockReturn } from './decrement-order-stock.js';
import { stockSnapshot } from './order-status-change.js';
import { orderStaffNotesRef } from './order-staff-notes.js';

export interface ItemCancelResponse {
  readonly orderId: string;
  readonly cancelId: string;
  readonly amountOffEgp: number;
  readonly refundEgp: number;
  readonly totalEgp: number;
  /** Pieces that couldn't go back into stock (the size or product is gone). Staff check by hand. */
  readonly notReturned: number;
}

/**
 * Cancel some pieces of one item (ATS-342), in one transaction on the live order: the rules in
 * `planItemCancel()` (store/order-item-cancel.ts), new `pricing.lines` and totals, the pieces and
 * their gifts back into stock when the order already took them, an entry on the order's
 * `itemCancels` (what the shopper and emails see), a staff-only row with the reason in
 * `orderStaffNotes/{orderId}.itemCancels`, and an `auditLogs` record.
 */
export async function cancelOrderItem(
  db: Firestore,
  req: ItemCancelRequest,
  actor: RequiredCaller,
): Promise<ItemCancelResponse> {
  const orderRef = db.collection('orders').doc(req.orderId);
  const auditRef = db.collection('auditLogs').doc();
  const cancelId = auditRef.id.slice(0, 12);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'That order could not be found.');
    const order: DocumentData = snap.data() ?? {};
    const result = planItemCancel(order, {
      lineIndex: req.lineIndex,
      quantity: req.quantity,
      amountOffEgp: req.amountOffEgp,
      expected: req.expected ?? null,
    });
    if (!result.ok) throw new HttpsError('failed-precondition', result.message);
    const plan = result.plan;
    if (plan.refundOwed && plan.amountOffEgp > 0 && !req.refundTo) {
      throw new HttpsError('invalid-argument', 'Add the InstaPay number or address to send the refund to.');
    }

    const oldLines = (order['pricing'] as { lines: DocumentData[] }).lines;
    const line = oldLines[plan.lineIndex]!;
    const item = pieceFromLine(line, plan.quantity);
    const gifts = plan.gifts.map((g) => pieceFromLine(oldLines[g.lineIndex]!, g.quantity));

    // Stock goes back only when the order took it (Confirmed).
    const stockTaken = orderStockTaken(order);
    const back = stockTaken ? aggregateOrderStockDemand([item, ...gifts]) : new Map();
    const ids = [...back.keys()];
    const productRefs = ids.map((id) => db.collection('products').doc(id));
    const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));

    // Every read is done; writes from here on.
    const now = FieldValue.serverTimestamp();
    let notReturned = 0;
    ids.forEach((id, i) => {
      const demand = back.get(id)!;
      const data = productSnaps[i]!.exists ? (productSnaps[i]!.data() ?? {}) : null;
      const pieces =
        demand.kind === 'flat'
          ? demand.quantity
          : Object.values(demand.bySize as Record<string, number>).reduce((a, b) => a + b, 0);
      if (!data) {
        notReturned += pieces;
        return;
      }
      const moved = applyStockReturn(stockSnapshot(data), demand);
      if (!moved) {
        notReturned += pieces;
        return;
      }
      notReturned += moved.skipped;
      tx.update(productRefs[i]!, {
        stock: moved.next.stock,
        inStock: moved.next.inStock,
        stockBySize: moved.next.stockBySize ?? FieldValue.delete(),
        updatedAt: now,
        updatedBy: actor.uid,
      });
    });

    const refundEgp = plan.refundOwed ? plan.amountOffEgp : 0;
    const at = Timestamp.now();
    const entry: DocumentData = {
      id: cancelId,
      item,
      gifts,
      amountOffEgp: plan.amountOffEgp,
      refundEgp,
      refundTo: refundEgp > 0 ? req.refundTo : null,
      totalBeforeEgp: plan.previousTotalEgp,
      totalAfterEgp: plan.totalEgp,
      statusAtCancel: order['status'] === 'confirmed' ? 'confirmed' : 'pending',
      stockReturned: stockTaken,
      notReturned,
      emailCustomer: req.emailCustomer,
      at,
      refundSentEgp: null,
      refundSentAt: null,
    };
    tx.update(orderRef, {
      'pricing.lines': plan.lines,
      'pricing.subtotalEgp': plan.subtotalEgp,
      'pricing.subtotalDisplay': plan.subtotalEgp,
      'pricing.totalEgp': plan.totalEgp,
      'pricing.totalDisplay': plan.totalEgp,
      itemCancels: FieldValue.arrayUnion(entry),
      ...(notReturned > 0 ? { stockNotReturned: FieldValue.increment(notReturned) } : {}),
      updatedAt: now,
    });
    tx.set(
      orderStaffNotesRef(db, req.orderId),
      {
        itemCancels: FieldValue.arrayUnion({
          id: cancelId,
          label: itemCancelLabel(item),
          at,
          by: actor.uid,
          ...(actor.email ? { byEmail: actor.email } : {}),
          ...(req.reason ? { reason: req.reason } : {}),
          amountOffEgp: plan.amountOffEgp,
          refundEgp,
        }),
        updatedAt: now,
      },
      { merge: true },
    );
    tx.set(auditRef, {
      action: 'order.item-cancel',
      orderId: req.orderId,
      cancelId,
      status: order['status'],
      paymentMethod: typeof order['paymentMethod'] === 'string' ? order['paymentMethod'] : null,
      item: itemCancelLabel(item),
      amountOffEgp: plan.amountOffEgp,
      refundEgp,
      totalBeforeEgp: plan.previousTotalEgp,
      totalAfterEgp: plan.totalEgp,
      actorUid: actor.uid,
      actorEmail: actor.email ?? actor.uid,
      at: now,
    });
    if (notReturned > 0)
      console.warn('Item cancel stock could not all go back', { orderId: req.orderId, notReturned });

    return {
      orderId: req.orderId,
      cancelId,
      amountOffEgp: plan.amountOffEgp,
      refundEgp,
      totalEgp: plan.totalEgp,
      notReturned,
    };
  });
}

export interface ItemRefundSentResponse {
  readonly orderId: string;
  readonly cancelId: string;
  /** False when it was already marked sent (nothing written). */
  readonly changed: boolean;
}

/** Staff sent an item cancel's refund by InstaPay: stamp it on the order's `itemCancels` entry. */
export async function markItemRefundSent(
  db: Firestore,
  req: ItemRefundSentRequest,
  actor: RequiredCaller,
): Promise<ItemRefundSentResponse> {
  const orderRef = db.collection('orders').doc(req.orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'That order could not be found.');
    const raw = snap.data()?.['itemCancels'];
    const list: DocumentData[] = Array.isArray(raw) ? raw : [];
    const index = list.findIndex((e) => e && e['id'] === req.cancelId);
    const entry = list[index];
    if (!entry)
      throw new HttpsError('not-found', 'That cancelled item could not be found. Refresh and try again.');
    if (!(typeof entry['refundEgp'] === 'number' && entry['refundEgp'] > 0)) {
      throw new HttpsError('failed-precondition', 'There is no refund to send for this item.');
    }
    if (entry['refundSentAt']) return { orderId: req.orderId, cancelId: req.cancelId, changed: false };
    const at = Timestamp.now();
    const next = list.map((e, i) =>
      i === index ? { ...e, refundSentEgp: entry['refundEgp'], refundSentAt: at } : e,
    );
    tx.update(orderRef, { itemCancels: next, updatedAt: FieldValue.serverTimestamp() });
    tx.set(
      orderStaffNotesRef(db, req.orderId),
      {
        itemRefunds: FieldValue.arrayUnion({
          id: req.cancelId,
          at,
          by: actor.uid,
          ...(actor.email ? { byEmail: actor.email } : {}),
          ...(req.reference ? { reference: req.reference } : {}),
        }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { orderId: req.orderId, cancelId: req.cancelId, changed: true };
  });
}
