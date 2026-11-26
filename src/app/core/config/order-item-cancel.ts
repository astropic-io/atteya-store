// GENERATED — edit functions/src/store
/**
 * Cancel some pieces of one item in an order before it ships (ATS-342): staff do it after a call
 * with the customer, instead of asking them to cancel it themselves. Pure: no Firestore, so every
 * rule is unit tested (`orders/order-item-cancel.test.ts`) and the admin dialog previews exactly
 * what the server saves. Edit ONLY this file (functions/src/store/order-item-cancel.ts), then run
 * `npm run sync:engine`, which copies it to src/app/core/config/order-item-cancel.ts.
 *
 * - Only Waiting for Payment or Confirmed orders shipped in Egypt and paid by Cash on Delivery or
 *   InstaPay. Card (no Paymob refunds yet), orders abroad, Shipped (with the courier; after
 *   delivery staff start a return for the customer), Delivered, Cancelled and Payment Failed are
 *   refused with a plain message (`itemCancelRefusal()`).
 * - The cancelled pieces leave `pricing.lines` (a line left with no pieces is removed, and gifts'
 *   `forLine` follow), so stock, totals, emails and a later Cancel Order all read a normal order.
 *   What was cancelled is kept in the order's `itemCancels` list for the order page and emails.
 * - The amount off defaults to what was paid for those pieces (the line's `lineDisplay` share,
 *   the same rule as a return refund). Staff may lower it, never so far that the pieces left cost
 *   more than their normal price (`minAmountOffEgp`), so a bundle can drop to its smaller row.
 * - The shipping fee never changes.
 * - Free gifts that came with the line go down with it: floor(pieces left × gifts ÷ pieces), and
 *   all of them once the line is gone (the same rule as returns).
 * - Confirmed InstaPay orders were paid in full, so the amount off is a refund to send by
 *   InstaPay. Cash on Delivery paid only the delivery fee first, so the cash at the door goes
 *   down. Waiting for Payment orders just owe less.
 * - Cancelling every piece left in the order is refused: use Cancel Order.
 */

export const ITEM_CANCEL_REASON_MAX = 300;
export const ITEM_CANCEL_REFUND_TO_MAX = 100;
export const ITEM_CANCEL_REFERENCE_MAX = 100;
/** At most this many item cancels per order, so a slip can't grow the order doc without end. */
export const ITEM_CANCELS_PER_ORDER_MAX = 20;

export const ITEM_CANCEL_LAST_PIECES_MESSAGE =
  "That's every item left in this order. Use Cancel Order instead.";

/** What the rules read from an order (the raw Firestore data is fine). */
export interface ItemCancelOrderFacts {
  readonly status?: unknown;
  readonly paymentMethod?: unknown;
  readonly shipping?: unknown;
  readonly pricing?: unknown;
  readonly itemCancels?: unknown;
}

/** One `pricing.lines` entry as these rules read it; every other field is kept as it is. */
export interface ItemCancelLine {
  readonly productId: string;
  readonly quantity: number;
  readonly unitEgp: number;
  readonly lineDisplay: number;
  readonly fullEgp?: number;
  readonly discountEgp?: number;
  readonly deals?: readonly {
    readonly units: number;
    readonly discountEgp: number;
    readonly bundle?: true;
  }[];
  readonly gift?: { readonly forLine: number };
  readonly [key: string]: unknown;
}

/** Why Cancel Item isn't offered for this order, or null when it is. */
export function itemCancelRefusal(order: ItemCancelOrderFacts): string | null {
  const status = order.status;
  if (status === 'cancelled' || status === 'failed') {
    return "This order is cancelled, so its items can't change.";
  }
  if (status === 'shipped') {
    return "This order is with the courier. Once it's delivered, use Start Return for Customer.";
  }
  if (status === 'delivered') {
    return 'This order is delivered. Use Start Return for Customer instead.';
  }
  if (status !== 'pending' && status !== 'confirmed') {
    return "This order's items can't change here.";
  }
  if (order.paymentMethod === 'paymob') {
    return "Card payments can't be partly refunded from the dashboard yet. Message the customer on WhatsApp.";
  }
  if (order.paymentMethod !== 'cash-on-delivery' && order.paymentMethod !== 'instapay') {
    return 'Items can only be cancelled on Cash on Delivery and InstaPay orders.';
  }
  const pricing = record(order.pricing);
  const shipping = record(order.shipping);
  if (
    pricing?.['isInternational'] === true ||
    pricing?.['payIn'] ||
    (shipping && shipping['country'] !== 'EG')
  ) {
    return "Items can't be cancelled on orders shipped abroad yet. Message the customer on WhatsApp.";
  }
  if (!pricing || readLines(pricing['lines']) === null) {
    return "This order's items can't be read, so they can't change here.";
  }
  if (readItemCancels(order.itemCancels).length >= ITEM_CANCELS_PER_ORDER_MAX) {
    return 'This order has had too many items cancelled. Message the customer on WhatsApp.';
  }
  return null;
}

export function canCancelItems(order: ItemCancelOrderFacts): boolean {
  return itemCancelRefusal(order) === null;
}

/** Confirmed InstaPay orders were paid in full, so the amount off goes back by InstaPay. */
export function itemCancelOwesRefund(order: ItemCancelOrderFacts): boolean {
  return order.status === 'confirmed' && order.paymentMethod === 'instapay';
}

/** Paid share of `pieces` pieces of a line, rounded so every share of the line adds up exactly. */
export function paidShareEgp(line: ItemCancelLine, pieces: number): number {
  if (line.quantity < 1 || pieces < 1) return 0;
  if (pieces >= line.quantity) return line.lineDisplay;
  // Taken from the end of the line, the same running rounding as a return refund.
  const keep = line.quantity - pieces;
  return line.lineDisplay - Math.round((line.lineDisplay * keep) / line.quantity);
}

/** Normal price of `pieces` pieces of a line, before any group discount (bundle, Buy X Get Y). */
export function fullPriceEgp(line: ItemCancelLine, pieces: number): number {
  if (line.quantity < 1 || pieces < 1) return 0;
  if (typeof line.fullEgp === 'number' && line.fullEgp > 0) {
    if (pieces >= line.quantity) return line.fullEgp;
    return Math.round((line.fullEgp * pieces) / line.quantity);
  }
  return line.unitEgp * pieces;
}

export interface ItemCancelInput {
  readonly lineIndex: number;
  readonly quantity: number;
  /** Whole EGP off the order; null = the default (what was paid for those pieces). */
  readonly amountOffEgp: number | null;
}

export interface ItemCancelGift {
  /** Index in the order's `pricing.lines` before this cancel. */
  readonly lineIndex: number;
  readonly quantity: number;
}

export interface ItemCancelPlan {
  readonly lineIndex: number;
  readonly quantity: number;
  /** Pieces of the line before the cancel. */
  readonly lineQuantity: number;
  readonly amountOffEgp: number;
  readonly defaultAmountOffEgp: number;
  readonly minAmountOffEgp: number;
  readonly maxAmountOffEgp: number;
  /** The line was in a group discount (bundle or Buy X Get Y). */
  readonly inGroupDeal: boolean;
  readonly gifts: readonly ItemCancelGift[];
  /** `pricing.lines` after the cancel (lines with no pieces removed, gifts' `forLine` renumbered). */
  readonly lines: readonly ItemCancelLine[];
  readonly subtotalEgp: number;
  readonly totalEgp: number;
  readonly previousTotalEgp: number;
  readonly shippingEgp: number;
  readonly refundOwed: boolean;
  /** Pieces left in the order after the cancel (gifts not counted). */
  readonly piecesLeft: number;
}

export type ItemCancelResult =
  { readonly ok: true; readonly plan: ItemCancelPlan } | { readonly ok: false; readonly message: string };

/** Everything a cancel of `input.quantity` pieces of line `input.lineIndex` changes, or why it can't. */
export function planItemCancel(order: ItemCancelOrderFacts, input: ItemCancelInput): ItemCancelResult {
  const refusal = itemCancelRefusal(order);
  if (refusal) return { ok: false, message: refusal };
  const pricing = record(order.pricing)!;
  const lines = readLines(pricing['lines'])!;
  const line = lines[input.lineIndex];
  if (!line) return { ok: false, message: "That item isn't in this order any more. Refresh and try again." };
  if (line.gift) {
    return { ok: false, message: 'A free gift goes with its item. Cancel the item it came with.' };
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > line.quantity) {
    return { ok: false, message: `Choose 1 to ${line.quantity} pieces.` };
  }

  const bought = lines.reduce((sum, l) => sum + (l.gift ? 0 : l.quantity), 0);
  const piecesLeft = bought - input.quantity;
  if (piecesLeft < 1) return { ok: false, message: ITEM_CANCEL_LAST_PIECES_MESSAGE };

  const keep = line.quantity - input.quantity;
  const maxOff = paidShareEgp(line, input.quantity);
  const paidLeft = line.lineDisplay - maxOff;
  // The pieces left may cost up to their normal price, never more.
  const minOff = Math.max(0, Math.min(maxOff, line.lineDisplay - fullPriceEgp(line, keep)));
  const amountOff = input.amountOffEgp === null ? maxOff : input.amountOffEgp;
  if (!Number.isInteger(amountOff) || amountOff < minOff || amountOff > maxOff) {
    return {
      ok: false,
      message:
        minOff === maxOff
          ? `The amount off is EGP ${maxOff} for these pieces.`
          : `Choose an amount off from EGP ${minOff} to EGP ${maxOff}.`,
    };
  }

  const gifts: ItemCancelGift[] = [];
  const removed = new Set<number>();
  const changed = new Map<number, ItemCancelLine>();
  lines.forEach((l, i) => {
    if (l.gift?.forLine !== input.lineIndex) return;
    const left = keep === 0 ? 0 : Math.floor((keep * l.quantity) / line.quantity);
    const off = l.quantity - left;
    if (off < 1) return;
    gifts.push({ lineIndex: i, quantity: off });
    if (left === 0) removed.add(i);
    else changed.set(i, { ...l, quantity: left, lineDisplay: 0 });
  });
  if (keep === 0) removed.add(input.lineIndex);
  else changed.set(input.lineIndex, reducedLine(line, keep, paidLeft + (maxOff - amountOff)));

  // Remove emptied lines and renumber the gifts that point past them.
  const newIndex = new Map<number, number>();
  let next = 0;
  lines.forEach((_, i) => {
    if (!removed.has(i)) newIndex.set(i, next++);
  });
  const newLines: ItemCancelLine[] = [];
  lines.forEach((l, i) => {
    if (removed.has(i)) return;
    const base = changed.get(i) ?? l;
    if (base.gift) {
      const forLine = newIndex.get(base.gift.forLine);
      newLines.push(forLine === undefined ? base : { ...base, gift: { ...base.gift, forLine } });
    } else {
      newLines.push(base);
    }
  });

  const subtotal = num(pricing['subtotalEgp']) - amountOff;
  const total = num(pricing['totalEgp']);
  const shipping = record(pricing['shipping']);
  return {
    ok: true,
    plan: {
      lineIndex: input.lineIndex,
      quantity: input.quantity,
      lineQuantity: line.quantity,
      amountOffEgp: amountOff,
      defaultAmountOffEgp: maxOff,
      minAmountOffEgp: minOff,
      maxAmountOffEgp: maxOff,
      inGroupDeal: (line.deals ?? []).some((d) => d.units > 0 && d.discountEgp > 0),
      gifts,
      lines: newLines,
      subtotalEgp: subtotal,
      totalEgp: total - amountOff,
      previousTotalEgp: total,
      shippingEgp: shipping ? num(shipping['priceEgp']) : 0,
      refundOwed: itemCancelOwesRefund(order),
      piecesLeft,
    },
  };
}

/** The line with `keep` pieces that now cost `lineDisplay` in all. */
function reducedLine(line: ItemCancelLine, keep: number, lineDisplay: number): ItemCancelLine {
  const out: Record<string, unknown> = { ...line, quantity: keep, lineDisplay };
  if (typeof line.fullEgp === 'number') {
    const full = fullPriceEgp(line, keep);
    out['fullEgp'] = full;
    const discount = Math.max(0, full - lineDisplay);
    out['discountEgp'] = discount;
    if (line.deals) {
      const before = line.deals.reduce((sum, d) => sum + d.discountEgp, 0);
      let left = discount;
      out['deals'] = line.deals.map((d, i, all) => {
        const share =
          i === all.length - 1 ? left : before > 0 ? Math.round((d.discountEgp * discount) / before) : 0;
        left -= share;
        return { ...d, units: Math.min(d.units, keep), discountEgp: Math.max(0, share) };
      });
    }
  }
  return out as ItemCancelLine;
}

// ---------------------------------------------------------------------------
// The order's `itemCancels` list (read by staff, the shopper's order page, orderViews and emails)
// ---------------------------------------------------------------------------

/** A piece that left the order, as saved: enough to show it without the live product. */
export interface ItemCancelPiece {
  readonly productId: string;
  readonly selection: Readonly<Record<string, string>>;
  readonly name: string;
  readonly optionLabels: readonly { readonly label: string; readonly value: string }[];
  readonly imagePath: string | null;
  readonly quantity: number;
}

export interface ItemCancelEntry {
  readonly id: string;
  readonly item: ItemCancelPiece;
  /** Free gifts that left with it. */
  readonly gifts: readonly ItemCancelPiece[];
  readonly amountOffEgp: number;
  /** EGP to send back by InstaPay (0 when nothing was paid for it yet). */
  readonly refundEgp: number;
  /** Where the refund goes (InstaPay number or address); null when no refund. */
  readonly refundTo: string | null;
  readonly totalBeforeEgp: number;
  readonly totalAfterEgp: number;
  readonly statusAtCancel: 'pending' | 'confirmed';
  readonly stockReturned: boolean;
  readonly emailCustomer: boolean;
  /** Milliseconds; saved as a Timestamp (arrays can't hold server time stamps). */
  readonly atMs: number;
  readonly refundSentEgp: number | null;
  readonly refundSentAtMs: number | null;
}

/** Reads the order's raw `itemCancels`, skipping anything it can't read. */
export function readItemCancels(raw: unknown): ItemCancelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ItemCancelEntry[] = [];
  for (const entry of raw) {
    const e = record(entry);
    if (!e || typeof e['id'] !== 'string') continue;
    const item = readPiece(e['item']);
    if (!item) continue;
    const gifts = Array.isArray(e['gifts'])
      ? e['gifts'].map(readPiece).filter((p): p is ItemCancelPiece => p !== null)
      : [];
    out.push({
      id: e['id'],
      item,
      gifts,
      amountOffEgp: num(e['amountOffEgp']),
      refundEgp: num(e['refundEgp']),
      refundTo: typeof e['refundTo'] === 'string' && e['refundTo'] ? e['refundTo'] : null,
      totalBeforeEgp: num(e['totalBeforeEgp']),
      totalAfterEgp: num(e['totalAfterEgp']),
      statusAtCancel: e['statusAtCancel'] === 'confirmed' ? 'confirmed' : 'pending',
      stockReturned: e['stockReturned'] === true,
      emailCustomer: e['emailCustomer'] === true,
      atMs: timeMs(e['at']) ?? 0,
      refundSentEgp: typeof e['refundSentEgp'] === 'number' ? e['refundSentEgp'] : null,
      refundSentAtMs: timeMs(e['refundSentAt']),
    });
  }
  return out;
}

/** EGP still to send back over all the order's item cancels. */
export function itemRefundsToSendEgp(raw: unknown): number {
  return readItemCancels(raw).reduce(
    (sum, e) => sum + (e.refundEgp > 0 && e.refundSentAtMs === null ? e.refundEgp : 0),
    0,
  );
}

/** Pieces cancelled over all the order's item cancels (gifts not counted). */
export function itemsCancelledCount(raw: unknown): number {
  return readItemCancels(raw).reduce((sum, e) => sum + e.item.quantity, 0);
}

/** "Club Socks · Black, Size 40–44 ×1" for history lines and snackbars. */
export function itemCancelLabel(piece: ItemCancelPiece): string {
  const options = piece.optionLabels.map((o) => `${o.label} ${o.value}`).join(', ');
  return `${piece.name}${options ? `, ${options}` : ''} ×${piece.quantity}`;
}

export interface ItemCancelRequest {
  readonly orderId: string;
  readonly lineIndex: number;
  readonly quantity: number;
  readonly amountOffEgp: number | null;
  readonly refundTo: string | null;
  readonly reason: string | null;
  readonly emailCustomer: boolean;
}

/** Checks the callable's input shape; the order rules run on the live order in the transaction. */
export function parseItemCancelRequest(raw: unknown): ItemCancelRequest | null {
  const r = record(raw);
  if (!r) return null;
  const orderId = r['orderId'];
  const lineIndex = r['lineIndex'];
  const quantity = r['quantity'];
  const amount = r['amountOffEgp'];
  if (typeof orderId !== 'string' || !orderId || orderId.length > 128 || orderId.includes('/')) return null;
  if (!Number.isInteger(lineIndex) || (lineIndex as number) < 0 || (lineIndex as number) > 100) return null;
  if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 100) return null;
  if (amount !== undefined && amount !== null && (!Number.isInteger(amount) || (amount as number) < 0))
    return null;
  const refundTo = cleanText(r['refundTo'], ITEM_CANCEL_REFUND_TO_MAX);
  const reason = cleanText(r['reason'], ITEM_CANCEL_REASON_MAX);
  if (refundTo === undefined || reason === undefined) return null;
  return {
    orderId,
    lineIndex: lineIndex as number,
    quantity: quantity as number,
    amountOffEgp: (amount as number | null | undefined) ?? null,
    refundTo,
    reason,
    emailCustomer: r['emailCustomer'] !== false,
  };
}

export interface ItemRefundSentRequest {
  readonly orderId: string;
  readonly cancelId: string;
  readonly reference: string | null;
}

export function parseItemRefundSentRequest(raw: unknown): ItemRefundSentRequest | null {
  const r = record(raw);
  if (!r) return null;
  const { orderId, cancelId } = r;
  if (typeof orderId !== 'string' || !orderId || orderId.length > 128 || orderId.includes('/')) return null;
  if (typeof cancelId !== 'string' || !cancelId || cancelId.length > 64) return null;
  const reference = cleanText(r['reference'], ITEM_CANCEL_REFERENCE_MAX);
  if (reference === undefined) return null;
  return { orderId, cancelId, reference };
}

/** Trimmed text, null when empty, undefined when it isn't text or is too long. */
function cleanText(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (text.length > max) return undefined;
  return text || null;
}

function readPiece(raw: unknown): ItemCancelPiece | null {
  const p = record(raw);
  if (!p || typeof p['productId'] !== 'string' || typeof p['name'] !== 'string') return null;
  const quantity = p['quantity'];
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) return null;
  const selection: Record<string, string> = {};
  const sel = record(p['selection']);
  if (sel) for (const [k, v] of Object.entries(sel)) if (typeof v === 'string') selection[k] = v;
  const optionLabels = Array.isArray(p['optionLabels'])
    ? p['optionLabels']
        .map(record)
        .filter(
          (o): o is Record<string, unknown> =>
            !!o && typeof o['label'] === 'string' && typeof o['value'] === 'string',
        )
        .map((o) => ({ label: o['label'] as string, value: o['value'] as string }))
    : [];
  return {
    productId: p['productId'],
    selection,
    name: p['name'],
    optionLabels,
    imagePath: typeof p['imagePath'] === 'string' ? p['imagePath'] : null,
    quantity,
  };
}

/** The saved line (or a gift line) as a piece of `quantity`, for `itemCancels`. */
export function pieceFromLine(line: Readonly<Record<string, unknown>>, quantity: number): ItemCancelPiece {
  return (
    readPiece({
      ...line,
      quantity,
      name: typeof line['name'] === 'string' && line['name'] ? line['name'] : 'Item',
    }) ?? {
      productId: String(line['productId'] ?? ''),
      selection: {},
      name: 'Item',
      optionLabels: [],
      imagePath: null,
      quantity,
    }
  );
}

function readLines(raw: unknown): ItemCancelLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ItemCancelLine[] = [];
  for (const entry of raw) {
    const l = record(entry);
    if (!l || typeof l['productId'] !== 'string') return null;
    const quantity = l['quantity'];
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) return null;
    const gift = record(l['gift']);
    const deals = Array.isArray(l['deals'])
      ? l['deals']
          .map(record)
          .filter((d): d is Record<string, unknown> => d !== null)
          .map((d) => ({ ...d, units: num(d['units']), discountEgp: num(d['discountEgp']) }))
      : undefined;
    out.push({
      ...l,
      productId: l['productId'],
      quantity,
      unitEgp: num(l['unitEgp']),
      lineDisplay: num(l['lineDisplay']),
      ...(typeof l['fullEgp'] === 'number' ? { fullEgp: l['fullEgp'] } : {}),
      ...(deals ? { deals } : {}),
      ...(gift && typeof gift['forLine'] === 'number' ? { gift: { ...gift, forLine: gift['forLine'] } } : {}),
    } as ItemCancelLine);
  }
  return out;
}

function timeMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const r = record(raw);
  if (!r) return null;
  if (typeof r['toMillis'] === 'function') return (r['toMillis'] as () => number)();
  const seconds = r['seconds'] ?? r['_seconds'];
  return typeof seconds === 'number' ? seconds * 1000 : null;
}

function num(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}
