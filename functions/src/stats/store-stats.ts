import { receivedEgp, type ReceivedEgpPricing } from '../offers/engine/received-egp.js';
import { readReturnOrderLines } from '../store/returns.js';

/**
 * Admin Overview (ATS-340): one summary per Cairo calendar day, rebuilt from scratch from that
 * day's orders and return requests by `store-stats.trigger.ts` and `scripts/fill-store-stats.mjs`.
 * Never added to or subtracted from, so retries and out-of-order events are safe.
 *
 * Two docs per day, both written only by the Admin SDK:
 *  - `storeStats/{YYYY-MM-DD}`: counts (orders, statuses, pieces, payment methods, places, best
 *    sellers by pieces, returns). Admin and staff read it.
 *  - `storeStatsMoney/{YYYY-MM-DD}`: pounds (received, refunds sent, best sellers by pounds).
 *    Admin only, so staff never see money (Firestore rules can't hide single fields).
 *
 * Pure rules here; tested in `store-stats.test.ts`.
 */
export const STORE_STATS_COLLECTION = 'storeStats';
export const STORE_STATS_MONEY_COLLECTION = 'storeStatsMoney';

/** The store's time zone: a day runs from midnight to midnight in Cairo (summer time included). */
export const STORE_TIME_ZONE = 'Africa/Cairo';

/** Most orders one day's rebuild reads (far above a busy day). */
export const MAX_DAY_ORDERS = 2000;
/** Most return requests one day's rebuild reads (sent that day, and refunded that day). */
export const MAX_DAY_RETURNS = 500;

/** The only order fields the summary reads (the trigger and the fill script select these). */
export const STATS_ORDER_FIELDS = [
  'status',
  'createdAt',
  'paymentMethod',
  'pricing.totalEgp',
  'pricing.subtotalEgp',
  'pricing.chargeEgp',
  'pricing.payIn',
  'pricing.lines',
  'shipping.city',
  'shipping.country',
] as const;

/** The only return request fields the summary reads. */
export const STATS_RETURN_FIELDS = ['status', 'createdAt', 'hasRefund', 'refundEgp', 'refundSentAt'] as const;

/** Statuses whose pounds and pieces count as sold (the same rule as `spentEgp` on Customers). */
const SOLD_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'shipped', 'delivered']);

/** Order statuses the summary counts by name (Payment Failed is counted on its own). */
export const STATS_ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;
export type StatsOrderStatus = (typeof STATS_ORDER_STATUSES)[number];

export const STATS_PAYMENT_METHODS = ['cash-on-delivery', 'instapay', 'paymob', 'bank-transfer'] as const;

/** `byPlace` key for every order delivered outside Egypt. */
export const ABROAD_PLACE = 'abroad';

/** Most products kept per day in the best sellers maps (by pieces). */
export const MAX_DAY_PRODUCTS = 100;

// ── Cairo days ──────────────────────────────────────────────────────────────

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: STORE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: STORE_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Cairo calendar day of an instant, as `YYYY-MM-DD`. */
export function cairoDayKey(ms: number): string {
  return dayKeyFormat.format(new Date(ms));
}

/** True for a real `YYYY-MM-DD` date. */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DAY_KEY.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Cairo wall-clock time minus UTC at an instant, in ms (+2 h in winter, +3 h in summer). */
function cairoOffsetMs(ms: number): number {
  const parts: Record<string, number> = {};
  for (const part of partsFormat.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    parts['year'] ?? 1970,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] ?? 0,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The first instant of a Cairo day (its midnight, or 01:00 on the night summer time starts). */
export function cairoDayStartMs(dayKey: string): number {
  const match = DAY_KEY.exec(dayKey);
  if (!match) throw new Error(`Not a day: ${dayKey}`);
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  let start = wall - cairoOffsetMs(wall);
  // A second pass settles the offset when the first guess sat across a summer time change.
  start = wall - cairoOffsetMs(start);
  // On a summer time night midnight doesn't exist: the day starts at the first instant on that date.
  while (cairoDayKey(start) !== dayKey) start += 60 * 60 * 1000;
  while (cairoDayKey(start - 60 * 1000) === dayKey) start -= 60 * 60 * 1000;
  return start;
}

/** The Cairo day after `dayKey`. */
export function nextDayKey(dayKey: string): string {
  const match = DAY_KEY.exec(dayKey);
  if (!match) throw new Error(`Not a day: ${dayKey}`);
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return next.toISOString().slice(0, 10);
}

/** `[start, end)` instants of a Cairo day. */
export function cairoDayRangeMs(dayKey: string): { readonly startMs: number; readonly endMs: number } {
  return { startMs: cairoDayStartMs(dayKey), endMs: cairoDayStartMs(nextDayKey(dayKey)) };
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** The fields of one order the summary needs. */
export interface StatsOrderInput {
  readonly status: string;
  readonly paymentMethod: string;
  readonly receivedEgp: number;
  /** `byPlace` key: the governorate (Egypt) or `abroad`. */
  readonly place: string;
  readonly lines: readonly StatsOrderLine[];
}

export interface StatsOrderLine {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  /** What the line was paid after offers, whole EGP; 0 for a free gift. */
  readonly paidEgp: number;
  readonly gift: boolean;
}

/** The fields of one return request the summary needs. */
export interface StatsReturnInput {
  readonly status: string;
  readonly hasRefund: boolean;
  readonly refundEgp: number;
  /** Sent on this day (counts toward Return requests). */
  readonly sentThisDay: boolean;
  /** Refund sent on this day (counts toward Refunds sent). */
  readonly refundedThisDay: boolean;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const wholeEgp = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/** One order doc as the summary reads it. */
export function statsOrderFrom(data: Readonly<Record<string, unknown>>): StatsOrderInput {
  const shipping = isRecord(data['shipping']) ? data['shipping'] : {};
  const pricing = isRecord(data['pricing']) ? data['pricing'] : {};
  const country = text(shipping['country']).toUpperCase();
  const abroad = country !== '' && country !== 'EG';
  const city = text(shipping['city']);
  return {
    status: text(data['status']),
    paymentMethod: text(data['paymentMethod']),
    receivedEgp: receivedEgp(pricing as ReceivedEgpPricing),
    place: abroad ? ABROAD_PLACE : city || 'unknown',
    lines: readReturnOrderLines(pricing['lines'])
      .filter((line) => line.productId && line.quantity > 0)
      .map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        paidEgp: line.paidEgp,
        gift: line.giftForLine !== null,
      })),
  };
}

/** One return request doc as the summary reads it, for the day `[startMs, endMs)`. */
export function statsReturnFrom(
  data: Readonly<Record<string, unknown>>,
  createdAtMs: number | null,
  refundSentAtMs: number | null,
  startMs: number,
  endMs: number,
): StatsReturnInput {
  const within = (ms: number | null) => ms !== null && ms >= startMs && ms < endMs;
  return {
    status: text(data['status']),
    hasRefund: data['hasRefund'] === true,
    refundEgp: wholeEgp(data['refundEgp']),
    sentThisDay: within(createdAtMs),
    refundedThisDay: within(refundSentAtMs) && text(data['status']) === 'refund-sent',
  };
}

// ── The summary ─────────────────────────────────────────────────────────────

/** `storeStats/{day}`: counts only. */
export interface DayCounts {
  readonly day: string;
  /** Placed this day, not counting Payment Failed. */
  readonly orders: number;
  /** Payment Failed attempts this day. */
  readonly failedOrders: number;
  /** Orders placed this day by their status now. */
  readonly byStatus: Readonly<Record<StatsOrderStatus, number>>;
  /** Confirmed, Shipped or Delivered orders placed this day. */
  readonly soldOrders: number;
  /** Paid pieces (not free gifts) in sold orders. */
  readonly pieces: number;
  /** Orders placed this day (not Payment Failed) by payment method. */
  readonly byPayment: Readonly<Record<string, number>>;
  /** Orders placed this day (not Payment Failed) by governorate, or `abroad`. */
  readonly byPlace: Readonly<Record<string, number>>;
  /** Pieces of each product in sold orders (top `MAX_DAY_PRODUCTS`). */
  readonly products: Readonly<Record<string, { readonly name: string; readonly pieces: number }>>;
  /** Return and exchange requests sent this day (not cancelled by the shopper). */
  readonly returns: number;
  /** Of those, requests with a refund item. */
  readonly refundRequests: number;
  /** Requests whose refund was sent this day. */
  readonly refundsSent: number;
}

/** `storeStatsMoney/{day}`: pounds, admin only. */
export interface DayMoney {
  readonly day: string;
  /** What the store received for sold orders placed this day (`receivedEgp()`). */
  readonly receivedEgp: number;
  /** Refunds sent this day. */
  readonly refundsEgp: number;
  /** Pounds paid for each product in sold orders (same products as `DayCounts.products`). */
  readonly productEgp: Readonly<Record<string, number>>;
}

export interface DayStats {
  readonly counts: DayCounts;
  readonly money: DayMoney;
}

export function orderIsSold(status: string): boolean {
  return SOLD_STATUSES.has(status);
}

const bump = (map: Record<string, number>, key: string, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

/** Firestore map keys can't hold `.`, `/` or start with `__`; a governorate name never does, but be safe. */
function safeKey(value: string): string {
  const cleaned = value.replace(/[./\[\]*`~]/g, ' ').trim();
  return cleaned.startsWith('__') || cleaned === '' ? 'unknown' : cleaned.slice(0, 80);
}

/** Builds one day's two docs from that day's orders and return requests. */
export function buildDayStats(
  day: string,
  orders: readonly StatsOrderInput[],
  returns: readonly StatsReturnInput[],
): DayStats {
  const byStatus: Record<StatsOrderStatus, number> = {
    pending: 0,
    confirmed: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
  };
  const byPayment: Record<string, number> = {};
  const byPlace: Record<string, number> = {};
  const pieces: Record<string, number> = {};
  const names: Record<string, string> = {};
  const productEgp: Record<string, number> = {};
  let placed = 0;
  let failed = 0;
  let sold = 0;
  let soldPieces = 0;
  let received = 0;

  for (const order of orders) {
    if (order.status === 'failed') {
      failed += 1;
      continue;
    }
    placed += 1;
    if ((STATS_ORDER_STATUSES as readonly string[]).includes(order.status)) {
      byStatus[order.status as StatsOrderStatus] += 1;
    }
    bump(byPayment, safeKey(order.paymentMethod || 'unknown'));
    bump(byPlace, safeKey(order.place));
    if (!orderIsSold(order.status)) continue;
    sold += 1;
    received += order.receivedEgp;
    for (const line of order.lines) {
      if (line.gift) continue;
      const id = safeKey(line.productId);
      soldPieces += line.quantity;
      bump(pieces, id, line.quantity);
      bump(productEgp, id, line.paidEgp);
      if (!names[id] && line.name) names[id] = line.name;
    }
  }

  const top = Object.keys(pieces)
    .sort((a, b) => (pieces[b] ?? 0) - (pieces[a] ?? 0) || a.localeCompare(b))
    .slice(0, MAX_DAY_PRODUCTS);
  const products: Record<string, { name: string; pieces: number }> = {};
  const topEgp: Record<string, number> = {};
  for (const id of top) {
    products[id] = { name: names[id] ?? '', pieces: pieces[id] ?? 0 };
    topEgp[id] = productEgp[id] ?? 0;
  }

  let sent = 0;
  let refundRequests = 0;
  let refundsSent = 0;
  let refundsEgp = 0;
  for (const request of returns) {
    if (request.sentThisDay && request.status !== 'cancelled') {
      sent += 1;
      if (request.hasRefund) refundRequests += 1;
    }
    if (request.refundedThisDay) {
      refundsSent += 1;
      refundsEgp += request.refundEgp;
    }
  }

  return {
    counts: {
      day,
      orders: placed,
      failedOrders: failed,
      byStatus,
      soldOrders: sold,
      pieces: soldPieces,
      byPayment,
      byPlace,
      products,
      returns: sent,
      refundRequests,
      refundsSent,
    },
    money: { day, receivedEgp: Math.round(received), refundsEgp, productEgp: topEgp },
  };
}

/** True when a day has nothing to show (its docs can be deleted). */
export function isEmptyDay(stats: DayStats): boolean {
  const c = stats.counts;
  return c.orders === 0 && c.failedOrders === 0 && c.returns === 0 && c.refundsSent === 0;
}

// ── Which days an event touches ─────────────────────────────────────────────

const ORDER_STAT_KEYS = ['status', 'paymentMethod', 'createdAt', 'pricing', 'shipping'] as const;

/** True when an order change can move the summary (status, payment, date, money, lines or place). */
export function orderStatsChanged(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!before || !after) return true;
  return ORDER_STAT_KEYS.some((key) => !sameValue(before[key], after[key]));
}

const RETURN_STAT_KEYS = ['status', 'createdAt', 'hasRefund', 'refundEgp', 'refundSentAt'] as const;

/** True when a return request change can move the summary. */
export function returnStatsChanged(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!before || !after) return true;
  return RETURN_STAT_KEYS.some((key) => !sameValue(before[key], after[key]));
}

/** Deep equality for Firestore values (Timestamps compare by `isEqual`). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const eq = (a as { isEqual?: unknown }).isEqual;
  if (typeof eq === 'function') return (eq as (other: unknown) => boolean).call(a, b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((key) =>
    sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** The distinct Cairo days of the given instants (nulls skipped). */
export function daysOf(...instants: readonly (number | null)[]): string[] {
  const days = new Set<string>();
  for (const ms of instants) if (ms !== null) days.add(cairoDayKey(ms));
  return [...days].sort();
}
