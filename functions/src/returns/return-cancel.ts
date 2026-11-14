import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  isReturnStatus,
  nextReturnStatuses,
  returnFeeBackEgp,
  RETURN_FEE_AUTO_CANCEL_DAYS,
  withReturnStatus,
} from '../store/returns.js';
import { RETURN_REQUESTS_COLLECTION } from './return-access.js';
import { productIdsOf, rejectKeptItems, rejectStockFor, type StepProduct } from './return-staff-step.js';
import {
  readStepProducts,
  RETURN_STAFF_NOTES_COLLECTION,
  writeStockMoves,
} from './return-staff-transaction.js';

const NOT_FOUND = "We couldn't find that request. Check the link in your order email.";
const TOO_LATE =
  'This request is already being handled, so it can no longer be cancelled. Please message us on WhatsApp.';

/** What the automatic cancel writes in the staff history (ATS-307). */
export const AUTO_CANCEL_HISTORY_LABEL = `Cancelled: the courier fee didn't arrive in ${RETURN_FEE_AUTO_CANCEL_DAYS} days`;

export interface CancelReturnOptions {
  /** `shopper` (Cancel Request) or `system` (the hourly schedule, ATS-307). */
  readonly by: 'shopper' | 'system';
  /** The shopper ticked "I already sent the courier fee" (Waiting for Payment only, ATS-307). */
  readonly feeAlreadyPaid: boolean;
  /**
   * Checked inside the transaction against the live request and order, before anything is
   * written. Throw to refuse (the shopper's owner check); answer false to skip quietly (the
   * schedule finds the request no longer due).
   */
  readonly check: (saved: DocumentData, order: DocumentData | undefined) => boolean;
  /** Who wrote the stock change (`updatedBy` on products). */
  readonly updatedBy: string;
}

/**
 * Cancels a return or exchange request in one transaction: the shopper's Cancel Request (ATS-291)
 * and the automatic cancel of an unpaid Waiting for Payment request (ATS-307) share this path.
 * From Waiting for Payment it moves the `rejectStock` saved at Approve once (`stockUndoneAt`),
 * exactly like staff's Reject, so the held new piece goes back into stock. Saves a paid courier fee
 * to send back (`feeBackEgp`), updates the order's `returns` entry and, after Approve, adds a staff
 * history row. Answers false when the request was already cancelled or `check` skipped it.
 */
export async function runCancelReturn(
  db: Firestore,
  requestId: string,
  opts: CancelReturnOptions,
): Promise<boolean> {
  const requestRef = db.collection(RETURN_REQUESTS_COLLECTION).doc(requestId);
  return db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    const saved = requestSnap.data();
    const orderId = saved?.['orderId'];
    if (!requestSnap.exists || !saved || typeof orderId !== 'string' || !orderId || orderId.includes('/')) {
      throw new HttpsError('not-found', NOT_FOUND);
    }
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await tx.get(orderRef);
    const order = orderSnap.exists ? orderSnap.data() : undefined;
    if (!opts.check(saved, order)) return false;
    const status = saved['status'];
    if (status === 'cancelled') return false;
    if (
      !isReturnStatus(status) ||
      !nextReturnStatuses(status, saved['hasRefund'] === true, true).includes('cancelled')
    ) {
      throw new HttpsError('failed-precondition', TOO_LATE);
    }
    if (opts.feeAlreadyPaid && status !== 'waiting-for-payment') {
      throw new HttpsError(
        'invalid-argument',
        'You pay the courier fee only after we approve your request, so there is nothing to send back.',
      );
    }

    // Approve already took the new pieces (Waiting for Payment): put them back like Reject, once.
    const undo = saved['stockUndoneAt'] ? null : rejectStockFor(saved);
    // A Wrong Item Sent correction must stay (Reject keeps it as `keptItems`). Such a request has
    // no fee to pay first today, so this never happens; refuse rather than move stock twice.
    if (undo && rejectKeptItems(saved).length > 0) {
      throw new HttpsError('failed-precondition', TOO_LATE);
    }
    const products = new Map<string, StepProduct | null>();
    if (undo) await readStepProducts(tx, db, productIdsOf(undo), products);

    // Writes from here on.
    const now = FieldValue.serverTimestamp();
    const feeBackEgp = returnFeeBackEgp(saved, status, opts.feeAlreadyPaid);
    const patch: DocumentData = {
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy: opts.by,
      updatedAt: now,
    };
    if (feeBackEgp > 0) patch['feeBackEgp'] = feeBackEgp;
    if (undo) {
      const moved = writeStockMoves(tx, db, products, undo, 'floor', opts.updatedBy);
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
      const label =
        opts.by === 'system'
          ? AUTO_CANCEL_HISTORY_LABEL
          : feeBackEgp > 0
            ? `Cancelled by the customer · courier fee to send back EGP ${feeBackEgp.toLocaleString('en-US')}`
            : null;
      tx.set(
        db.collection(RETURN_STAFF_NOTES_COLLECTION).doc(requestId),
        {
          history: FieldValue.arrayUnion({
            status: 'cancelled',
            from: status,
            at: Timestamp.now(),
            by: opts.by,
            byEmail: opts.by === 'system' ? 'automatic' : 'the customer',
            ...(label ? { label } : {}),
          }),
          updatedAt: now,
        },
        { merge: true },
      );
    }
    if (order) {
      tx.update(orderRef, {
        returns: withReturnStatus(order['returns'], requestId, 'cancelled', {
          feeBackEgp,
          autoCancelled: opts.by === 'system',
        }),
      });
    }
    return true;
  });
}
