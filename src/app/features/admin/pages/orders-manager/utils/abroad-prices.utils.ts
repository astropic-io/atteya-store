import { displayDecimals, toDisplayAmount, type CurrencyEntry } from '@core/services/offers/engine';
import type { OrderDoc, OrderStaffNotes } from '@core/services/orders/order.schema';
import { formatMoney } from '@shared/utils/money';

/**
 * A Bank Transfer or Card order shipped abroad and paid in another currency (ATS-304, ATS-311): what the customer
 * pays in their currency, what that comes to in pounds, and the same order's price in Egypt.
 * Everything comes from the order's own `pricing.payIn` and, for the rate, its staff-only
 * `orderStaffNotes.payInRate`; nothing about currencies is fixed here.
 */
export interface AbroadPrices {
  readonly currency: string;
  readonly decimals: number;
  /** The order total in the customer's currency (`payIn.amount`). */
  readonly amount: number;
  /** The same order at Egypt prices, whole EGP. */
  readonly egyptTotal: number;
  /**
   * Each line in the customer's currency (index-matched to `pricing.lines`) and the shipping fee.
   * Null on orders placed before they were saved: those keep the old look.
   */
  readonly lines: readonly number[] | null;
  readonly shipping: number | null;
  /**
   * The shipping fee was converted at the plain rate with no markup (orders from ATS-311 on), so in
   * pounds it is its Egypt price. False on older orders, whose shipping had the markup.
   */
  readonly shippingAtPlainRate: boolean;
  /** The factor `amount` was worked out with, for struck-out prices; null when not saved. */
  readonly entry: CurrencyEntry | null;
  /** Pounds per 1 unit of the customer's currency on the day (1 ÷ the saved rate); null when not saved. */
  readonly egpPerUnit: number | null;
  readonly markupPercent: number | null;
}

/** The abroad prices of an order, or null for every other order (they look as before). */
export function abroadPrices(
  order: OrderDoc,
  payInRate: OrderStaffNotes['payInRate'] = null,
): AbroadPrices | null {
  const pricing = order.pricing;
  const payIn = pricing.payIn;
  const method = order.paymentMethod;
  if ((method !== 'bank-transfer' && method !== 'paymob') || !payIn || payIn.currency === 'EGP') return null;
  const decimals = displayDecimals(payIn.currency);
  const linesSaved =
    payIn.lines !== undefined &&
    payIn.shipping !== undefined &&
    pricing.currency === 'EGP' &&
    payIn.lines.length === pricing.lines.length &&
    sameAmount(payIn.lines.reduce((sum, value) => sum + value, 0) + payIn.shipping, payIn.amount, decimals);
  return {
    currency: payIn.currency,
    decimals,
    amount: payIn.amount,
    egyptTotal: pricing.totalEgp ?? pricing.totalDisplay,
    lines: linesSaved ? (payIn.lines ?? null) : null,
    shipping: linesSaved ? (payIn.shipping ?? null) : null,
    shippingAtPlainRate: payIn.shippingFactor !== undefined,
    entry: payIn.factor ? { code: payIn.currency, factor: payIn.factor } : null,
    egpPerUnit: payInRate ? 1 / payInRate.rate : null,
    markupPercent: payInRate?.markupPercent ?? null,
  };
}

/** An amount in the customer's currency, e.g. `QAR 96` or `KWD 6.250`. */
export function customerMoney(prices: AbroadPrices, amount: number): string {
  return formatMoney(amount, prices.currency, prices.decimals);
}

/** What an amount in the customer's currency comes to in whole pounds; null when the rate is unknown. */
export function inPounds(prices: AbroadPrices, amount: number): number | null {
  return prices.egpPerUnit === null ? null : Math.round(amount * prices.egpPerUnit);
}

/**
 * "Abroad · QAR", the tag beside such an order's total in the list; "Paid from abroad · QAR" for
 * an order delivered to someone in Egypt and paid from abroad.
 */
export function abroadTag(prices: AbroadPrices, paidFromAbroad = false): string {
  return `${paidFromAbroad ? 'Paid from abroad' : 'Abroad'} · ${prices.currency}`;
}

/** "+408 abroad": what abroad prices add to a line's Egypt price; null when there is nothing to add. */
export function abroadExtra(pounds: number | null, egypt: number): string | null {
  if (pounds === null || pounds <= egypt) return null;
  return `+${(pounds - egypt).toLocaleString('en-US')} abroad`;
}

/** "Abroad prices +40% · rate on the day 1 QAR = 14.66 EGP"; null without the saved % and rate. */
export function abroadRateLine(prices: AbroadPrices): string | null {
  if (prices.egpPerUnit === null || prices.markupPercent === null) return null;
  const rate = prices.egpPerUnit.toLocaleString('en-US', {
    maximumFractionDigits: prices.egpPerUnit >= 1 ? 2 : 4,
    maximumSignificantDigits: prices.egpPerUnit >= 1 ? undefined : 3,
  });
  const percent = prices.markupPercent.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `Abroad prices +${percent}% · rate on the day 1 ${prices.currency} = ${rate} EGP`;
}

/** A line's price before its Buy X Get Y discount, in the customer's currency; null without the factor. */
export function customerWas(
  prices: AbroadPrices,
  line: { readonly unitEgp: number; readonly quantity: number; readonly fullEgp?: number },
): number | null {
  if (!prices.entry) return null;
  return line.fullEgp !== undefined
    ? toDisplayAmount(line.fullEgp, prices.entry)
    : Number((toDisplayAmount(line.unitEgp, prices.entry) * line.quantity).toFixed(prices.decimals));
}

/** One unit in the customer's currency (as Place Order converted it); null without the factor. */
export function customerUnit(prices: AbroadPrices, unitEgp: number): number | null {
  return prices.entry ? toDisplayAmount(unitEgp, prices.entry) : null;
}

function sameAmount(a: number, b: number, decimals: number): boolean {
  return Math.abs(a - b) < 0.5 * 10 ** -decimals;
}
