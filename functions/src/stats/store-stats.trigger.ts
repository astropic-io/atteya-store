import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  buildDayStats,
  cairoDayRangeMs,
  daysOf,
  MAX_DAY_ORDERS,
  MAX_DAY_RETURNS,
  orderStatsChanged,
  returnStatsChanged,
  STATS_ORDER_FIELDS,
  STATS_RETURN_FIELDS,
  statsOrderFrom,
  statsReturnFrom,
  STORE_STATS_COLLECTION,
  STORE_STATS_MONEY_COLLECTION,
  type StatsReturnInput,
} from './store-stats.js';

const TRIGGER_OPTIONS = { region: 'europe-west3', retry: true } as const;

/** Field holding the read time of the orders a day was built from; an older build never overwrites a newer one. */
const BUILT_FROM_FIELD = 'builtFromReadTime';

const toMs = (value: unknown): number | null => (value instanceof Timestamp ? value.toMillis() : null);

/**
 * Rebuilds `storeStats/{day}` and `storeStatsMoney/{day}` from scratch from every order placed that
 * Cairo day and every return request sent or refunded that day. Reads outside the transaction (so
 * orders are never locked), then writes only when this read is newer than the one the day was
 * built from. A day that has nothing left is written with zeros (never deleted) so that guard stays.
 */
export async function rebuildStoreStatsDay(db: Firestore, day: string): Promise<void> {
  const { startMs, endMs } = cairoDayRangeMs(day);
  const start = Timestamp.fromMillis(startMs);
  const end = Timestamp.fromMillis(endMs);

  const [ordersSnap, sentSnap, refundedSnap] = await Promise.all([
    db
      .collection('orders')
      .where('createdAt', '>=', start)
      .where('createdAt', '<', end)
      .select(...STATS_ORDER_FIELDS)
      .limit(MAX_DAY_ORDERS)
      .get(),
    db
      .collection('returnRequests')
      .where('createdAt', '>=', start)
      .where('createdAt', '<', end)
      .select(...STATS_RETURN_FIELDS)
      .limit(MAX_DAY_RETURNS)
      .get(),
    db
      .collection('returnRequests')
      .where('refundSentAt', '>=', start)
      .where('refundSentAt', '<', end)
      .select(...STATS_RETURN_FIELDS)
      .limit(MAX_DAY_RETURNS)
      .get(),
  ]);
  if (ordersSnap.size >= MAX_DAY_ORDERS) {
    logger.warn('Store stats: day has more orders than one rebuild reads', { day, limit: MAX_DAY_ORDERS });
  }

  const orders = ordersSnap.docs.map((doc) => statsOrderFrom(doc.data()));
  const requests = new Map<string, StatsReturnInput>();
  for (const doc of [...sentSnap.docs, ...refundedSnap.docs]) {
    requests.set(
      doc.id,
      statsReturnFrom(doc.data(), toMs(doc.get('createdAt')), toMs(doc.get('refundSentAt')), startMs, endMs),
    );
  }
  const stats = buildDayStats(day, orders, [...requests.values()]);
  const readTime = ordersSnap.readTime;

  const countsRef = db.collection(STORE_STATS_COLLECTION).doc(day);
  const moneyRef = db.collection(STORE_STATS_MONEY_COLLECTION).doc(day);
  await db.runTransaction(async (tx) => {
    const current = await tx.get(countsRef);
    const builtFrom = current.get(BUILT_FROM_FIELD);
    if (builtFrom instanceof Timestamp && builtFrom.valueOf() > readTime.valueOf()) return;
    // A day left with nothing (for example after Delete Order) is written with zeros, never deleted,
    // so the read-time guard stays and an older rebuild still in flight can't bring back old numbers.
    const stamp = { [BUILT_FROM_FIELD]: readTime, updatedAt: FieldValue.serverTimestamp() };
    tx.set(countsRef, { ...stats.counts, ...stamp });
    tx.set(moneyRef, { ...stats.money, ...stamp });
  });
}

/** Any order change that can move the numbers rebuilds the day it was placed (both days if its date moved). */
export const onOrderWrittenStoreStats = onDocumentWritten(
  { ...TRIGGER_OPTIONS, document: 'orders/{orderId}' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!orderStatsChanged(before, after)) return;
    const days = daysOf(toMs(before?.['createdAt']), toMs(after?.['createdAt']));
    const db = getFirestore();
    for (const day of days) await rebuildStoreStatsDay(db, day);
  },
);

/** A return request rebuilds the day it was sent and the day its refund was sent. */
export const onReturnRequestWrittenStoreStats = onDocumentWritten(
  { ...TRIGGER_OPTIONS, document: 'returnRequests/{requestId}' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!returnStatsChanged(before, after)) return;
    const days = daysOf(
      toMs(before?.['createdAt']),
      toMs(after?.['createdAt']),
      toMs(before?.['refundSentAt']),
      toMs(after?.['refundSentAt']),
    );
    const db = getFirestore();
    for (const day of days) await rebuildStoreStatsDay(db, day);
  },
);
