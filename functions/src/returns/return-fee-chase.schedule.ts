import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { RETURN_FEE_REMINDER_DAYS, returnFeeChase, type ReturnStatus } from '../store/returns.js';
import { RETURN_REQUESTS_COLLECTION } from './return-access.js';
import { runCancelReturn } from './return-cancel.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Requests handled per run; the next hourly run picks up the rest. */
const BATCH = 100;
const WAITING: ReturnStatus = 'waiting-for-payment';

/**
 * Every hour (ATS-307): a request still Waiting for Payment 2 days after Approve gets one reminder
 * (`feeReminderSentAt`, which makes `sendReturnEmails` send the shopper and staff emails once), and
 * one still waiting after 5 days cancels itself through the same transaction as the shopper's
 * Cancel (`runCancelReturn`, `cancelledBy: 'system'`), so the held new piece goes back to stock
 * exactly once. Each request is checked again inside its transaction, so a Payment Received or a
 * Cancel that lands first wins and the schedule does nothing.
 */
export const chaseReturnFees = onSchedule(
  {
    schedule: 'every 1 hours',
    timeZone: 'Africa/Cairo',
    region: 'europe-west3',
    timeoutSeconds: 300,
  },
  async () => {
    try {
      const result = await chaseFees(getFirestore(), Date.now());
      if (result.reminded > 0 || result.cancelled > 0 || result.failed > 0) {
        logger.info('Return fee chase done', result);
      }
    } catch (error: unknown) {
      logger.error('Return fee chase failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  },
);

async function chaseFees(
  db: Firestore,
  nowMs: number,
): Promise<{ reminded: number; cancelled: number; failed: number }> {
  const col = db.collection(RETURN_REQUESTS_COLLECTION);
  const cutoff = Timestamp.fromMillis(nowMs - RETURN_FEE_REMINDER_DAYS * DAY_MS);
  // Index: returnRequests status + waitingForPaymentAt.
  const due = await col
    .where('status', '==', WAITING)
    .where('waitingForPaymentAt', '<=', cutoff)
    .orderBy('waitingForPaymentAt')
    .limit(BATCH)
    .get();
  // Requests approved before `waitingForPaymentAt` was saved (dev test data) fall back to `approvedAt`.
  const older = await col.where('status', '==', WAITING).limit(BATCH).get();
  const ids = new Set(due.docs.map((doc) => doc.id));
  for (const doc of older.docs) {
    if (!doc.get('waitingForPaymentAt')) ids.add(doc.id);
  }

  let reminded = 0;
  let cancelled = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const done = await chaseOne(db, id, nowMs);
      if (done === 'remind') reminded += 1;
      if (done === 'cancel') cancelled += 1;
    } catch (error: unknown) {
      failed += 1;
      logger.error('Return fee chase failed for a request', {
        requestId: id,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  return { reminded, cancelled, failed };
}

/** Reminds or cancels one request, checked again against the live document. */
async function chaseOne(
  db: Firestore,
  requestId: string,
  nowMs: number,
): Promise<'none' | 'remind' | 'cancel'> {
  const ref = db.collection(RETURN_REQUESTS_COLLECTION).doc(requestId);
  const snap = await ref.get();
  const action = returnFeeChase(snap.data() ?? {}, nowMs);
  if (action === 'cancel') {
    const changed = await runCancelReturn(db, requestId, {
      by: 'system',
      feeAlreadyPaid: false,
      updatedBy: 'system',
      check: (saved) => returnFeeChase(saved, nowMs) === 'cancel',
    });
    return changed ? 'cancel' : 'none';
  }
  if (action === 'remind') {
    const changed = await db.runTransaction(async (tx) => {
      const live = await tx.get(ref);
      if (returnFeeChase(live.data() ?? {}, nowMs) !== 'remind') return false;
      tx.update(ref, { feeReminderSentAt: FieldValue.serverTimestamp() });
      return true;
    });
    return changed ? 'remind' : 'none';
  }
  return 'none';
}
