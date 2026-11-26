/**
 * One-off (ATS-340): builds `storeStats/{YYYY-MM-DD}` and `storeStatsMoney/{YYYY-MM-DD}` for every
 * Cairo day that has orders or return requests, from all existing orders and returns. New changes
 * keep them up to date through `functions/src/stats/store-stats.trigger.ts`, which uses the same
 * rules (`buildDayStats()` in `store-stats.ts`).
 *
 * Run from the functions directory with Application Default Credentials:
 *   npm run build
 *   node scripts/fill-store-stats.mjs --project atteya-store-dev           (dry run)
 *   node scripts/fill-store-stats.mjs --project atteya-store-dev --apply   (writes)
 *
 * Prod needs --confirm-prod as well. Safe to run again, even while orders come in: every day is
 * rebuilt from scratch with the trigger's read-time check, and a saved day that no longer has
 * orders or returns is set to zero (never deleted).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const next = process.argv[index + 1];
  if (next === undefined || next.startsWith('--')) return true;
  return next;
};

const projectId = arg('project');
const dryRun = arg('apply') !== true;
const confirmProd = arg('confirm-prod') === true;

if (!['atteya-store-dev', 'attiya-store'].includes(projectId)) {
  throw new Error('--project must be atteya-store-dev or attiya-store');
}
if (projectId === 'attiya-store' && !dryRun && !confirmProd) {
  throw new Error('Writing to prod requires --confirm-prod.');
}

const {
  buildDayStats,
  cairoDayKey,
  cairoDayRangeMs,
  isEmptyDay,
  STATS_ORDER_FIELDS,
  STATS_RETURN_FIELDS,
  statsOrderFrom,
  statsReturnFrom,
  STORE_STATS_COLLECTION,
  STORE_STATS_MONEY_COLLECTION,
} = require(join(__dirname, '../lib/stats/store-stats.js'));

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const toMs = (value) => (value instanceof Timestamp ? value.toMillis() : null);

console.log(`Project: ${projectId}${dryRun ? ' (dry run, nothing is written)' : ''}`);

const ordersSnap = await db
  .collection('orders')
  .select(...STATS_ORDER_FIELDS)
  .get();
const returnsSnap = await db
  .collection('returnRequests')
  .select(...STATS_RETURN_FIELDS)
  .get();
const readTime = ordersSnap.readTime;

/** day → { orders: [], returns: Map<id, raw> } */
const days = new Map();
const dayOf = (key) => {
  if (!days.has(key)) days.set(key, { orders: [], returns: new Map() });
  return days.get(key);
};

let undated = 0;
for (const doc of ordersSnap.docs) {
  const ms = toMs(doc.get('createdAt'));
  if (ms === null) {
    undated += 1;
    continue;
  }
  dayOf(cairoDayKey(ms)).orders.push(statsOrderFrom(doc.data()));
}
for (const doc of returnsSnap.docs) {
  const created = toMs(doc.get('createdAt'));
  const refunded = toMs(doc.get('refundSentAt'));
  for (const ms of [created, refunded]) {
    if (ms !== null) dayOf(cairoDayKey(ms)).returns.set(doc.id, { data: doc.data(), created, refunded });
  }
}

const existing = await db.collection(STORE_STATS_COLLECTION).select().get();
const stale = existing.docs.map((doc) => doc.id).filter((id) => !days.has(id));

const writes = [];
let totalOrders = 0;
let totalEgp = 0;
for (const [day, entry] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const { startMs, endMs } = cairoDayRangeMs(day);
  const returns = [...entry.returns.values()].map(({ data, created, refunded }) =>
    statsReturnFrom(data, created, refunded, startMs, endMs),
  );
  const stats = buildDayStats(day, entry.orders, returns);
  if (isEmptyDay(stats)) {
    stale.push(day);
    continue;
  }
  totalOrders += stats.counts.orders;
  totalEgp += stats.money.receivedEgp;
  writes.push(stats);
}

console.log(`Orders read: ${ordersSnap.size} (${undated} with no date, left out)`);
console.log(`Return requests read: ${returnsSnap.size}`);
console.log(`Days to write: ${writes.length}, holding ${totalOrders} orders and EGP ${totalEgp} received`);
console.log(`Saved days to set to zero (nothing left): ${stale.length}`);
for (const stats of writes.slice(-7)) {
  console.log(
    `  ${stats.counts.day}: ${stats.counts.orders} orders, ${stats.counts.pieces} pieces, EGP ${stats.money.receivedEgp}`,
  );
}

if (dryRun) {
  console.log('Dry run done. Run again with --apply to write.');
  process.exit(0);
}

const stamp = { builtFromReadTime: readTime, updatedAt: FieldValue.serverTimestamp() };
/**
 * Writes one day the way the trigger does: only when this read is newer than the one the saved day
 * was built from, so a rebuild the trigger made while this script ran is never rolled back.
 */
let skipped = 0;
const writeDay = (counts, money) =>
  db.runTransaction(async (tx) => {
    const countsRef = db.collection(STORE_STATS_COLLECTION).doc(counts.day);
    const current = await tx.get(countsRef);
    const builtFrom = current.get('builtFromReadTime');
    if (builtFrom instanceof Timestamp && builtFrom.valueOf() > readTime.valueOf()) {
      skipped += 1;
      return;
    }
    tx.set(countsRef, { ...counts, ...stamp });
    tx.set(db.collection(STORE_STATS_MONEY_COLLECTION).doc(money.day), { ...money, ...stamp });
  });

for (const stats of writes) await writeDay(stats.counts, stats.money);
// A saved day with nothing left is written with zeros, never deleted, so the trigger's guard stays.
for (const day of stale) {
  const empty = buildDayStats(day, [], []);
  await writeDay(empty.counts, empty.money);
}
console.log(
  `Done: wrote ${writes.length} days, set ${stale.length} to zero, skipped ${skipped} the store had already updated.`,
);
