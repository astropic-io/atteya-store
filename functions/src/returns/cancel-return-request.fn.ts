import { FieldValue, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminCallableOptions, requireAppCheck } from '../auth/callable-options.js';
import { isReturnStatus, nextReturnStatuses, withReturnStatus } from '../store/returns.js';
import { isOrderShopper, RETURN_REQUESTS_COLLECTION } from './return-access.js';
import {
  applyStockMoves,
  productIdsOf,
  rejectKeptItems,
  rejectStockFor,
  type StepProduct,
} from './return-staff-step.js';
import { productRef, RETURN_STAFF_NOTES_COLLECTION, stepProduct } from './return-staff-transaction.js';

export interface CancelReturnRequestResponse {
  readonly requestId: string;
  readonly status: 'cancelled';
  /** False when the request was already cancelled. */
  readonly changed: boolean;
}

const NOT_FOUND = "We couldn't find that request. Check the link in your order email.";

/**
 * The shopper cancels their own return or exchange request while it is still Requested
 * (ATS-291) or Waiting for Payment (ATS-303). Same owner check as `requestReturn` (uid, or the
 * order's `viewKey`). From Waiting for Payment it moves the `rejectStock` saved at Approve once
 * (`stockUndoneAt`), exactly like staff's Reject, so the held new piece goes back into stock.
 * Updates the request and its entry in the order's `returns` summary in one transaction and
 * sends nothing.
 */
export const cancelReturnRequest = onCall(
  adminCallableOptions(),
  async (request): Promise<CancelReturnRequestResponse> => {
    requireAppCheck(request);
    const data = isRecord(request.data) ? request.data : {};
    const requestId = data['requestId'];
    const viewKeyRaw = data['viewKey'];
    const viewKey = typeof viewKeyRaw === 'string' && viewKeyRaw.length > 0 ? viewKeyRaw : null;
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(requestId)) {
      throw new HttpsError('invalid-argument', NOT_FOUND);
    }

    const db = getFirestore();
    const requestRef = db.collection(RETURN_REQUESTS_COLLECTION).doc(requestId);
    const changed = await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      const saved = requestSnap.data();
      const orderId = saved?.['orderId'];
      if (!requestSnap.exists || !saved || typeof orderId !== 'string' || !orderId || orderId.includes('/')) {
        throw new HttpsError('not-found', NOT_FOUND);
      }
      const orderRef = db.collection('orders').doc(orderId);
      const orderSnap = await tx.get(orderRef);
      const order = orderSnap.data();
      if (!orderSnap.exists || !order || !isOrderShopper(order, request, viewKey)) {
        throw new HttpsError('not-found', NOT_FOUND);
      }
      const status = saved['status'];
      if (status === 'cancelled') return false;
      if (
        !isReturnStatus(status) ||
        !nextReturnStatuses(status, saved['hasRefund'] === true, true).includes('cancelled')
      ) {
        throw new HttpsError(
          'failed-precondition',
          'This request is already being handled, so it can no longer be cancelled. Please message us on WhatsApp.',
        );
      }

      // Approve already took the new pieces (Waiting for Payment): put them back like Reject.
      const undo = rejectStockFor(saved);
      // A Wrong Item Sent correction must stay (Reject keeps it as `keptItems`). Such a request has
      // no fee to pay first today, so this never happens; refuse rather than move stock twice.
      if (undo && rejectKeptItems(saved).length > 0) {
        throw new HttpsError(
          'failed-precondition',
          'This request is already being handled, so it can no longer be cancelled. Please message us on WhatsApp.',
        );
      }
      const products = new Map<string, StepProduct | null>();
      if (undo) {
        const ids = productIdsOf(undo);
        const snaps = await Promise.all(ids.map((id) => tx.get(productRef(db, id))));
        ids.forEach((id, index) => {
          const snap = snaps[index]!;
          products.set(id, snap.exists ? stepProduct(snap.data() ?? {}) : null);
        });
      }

      // Writes from here on.
      const now = FieldValue.serverTimestamp();
      const patch: DocumentData = {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: 'shopper',
        updatedAt: now,
      };
      if (undo) {
        const moved = applyStockMoves(products, undo, { short: 'floor' });
        for (const [productId, next] of moved.next) {
          tx.update(productRef(db, productId), {
            stock: next.stock,
            inStock: next.inStock,
            stockBySize: next.stockBySize ?? FieldValue.delete(),
            updatedAt: now,
            updatedBy: request.auth?.uid ?? 'shopper',
          });
        }
        patch['stockUndoneAt'] = now;
        if (moved.notReturned > 0) {
          const before = typeof saved['stockNotReturned'] === 'number' ? saved['stockNotReturned'] : 0;
          patch['stockNotReturned'] = before + moved.notReturned;
          console.warn('Return stock could not all go back', { requestId, notReturned: moved.notReturned });
        }
      }
      tx.update(requestRef, patch);
      // Staff see a cancel after Approve in the history: the shopper may already have paid the fee.
      if (status !== 'requested') {
        tx.set(
          db.collection(RETURN_STAFF_NOTES_COLLECTION).doc(requestId),
          {
            history: FieldValue.arrayUnion({
              status: 'cancelled',
              from: status,
              at: Timestamp.now(),
              by: 'shopper',
              byEmail: 'the customer',
            }),
            updatedAt: now,
          },
          { merge: true },
        );
      }
      tx.update(orderRef, { returns: withReturnStatus(order['returns'], requestId, 'cancelled') });
      return true;
    });
    return { requestId, status: 'cancelled', changed };
  },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
