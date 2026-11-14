import {
  displayDecimals,
  isUnreliableCurrency,
  shippingEntry,
  toDisplayAmount,
  type CurrencyEntry,
} from '../offers/engine/currency.js';
import type {
  OrderLinePrice,
  OrderPayIn,
  OrderPricingSnapshot,
  OrderShippingLine,
} from './order-pricing.server.js';

/** The currency an order shipped abroad falls back to when the country's own one can't be used. */
export const PAY_IN_FALLBACK_CURRENCY = 'USD';

/**
 * The currency an order shipped abroad is priced in (Bank Transfer and Card, ATS-311): the delivery country's (`requested`, from
 * `currencyFromCountry()`) when `settings/currency` has a usable factor for it, else USD. Never
 * EGP: a shopper whose order ships abroad never sees pounds or the Egypt price (ATS-309). Null
 * when neither has a factor (the order is then refused: we can't say how much to send).
 */
export function payInEntry(
  requested: string | null,
  currencies: Readonly<Record<string, unknown>>,
): CurrencyEntry | null {
  const usable = (code: string | null): CurrencyEntry | null => {
    if (!code || code === 'EGP' || isUnreliableCurrency(code)) return null;
    const entry = currencies[code];
    if (!entry || typeof entry !== 'object') return null;
    const factor = (entry as Record<string, unknown>)['factor'];
    if (!isPositive(factor)) return null;
    // The plain rate for the shipping fee (ATS-311), when this `settings/currency` has it.
    const shippingFactor = (entry as Record<string, unknown>)['shippingFactor'];
    return isPositive(shippingFactor) ? { code, factor, shippingFactor } : { code, factor };
  };
  return usable(requested) ?? usable(PAY_IN_FALLBACK_CURRENCY);
}

/**
 * The order total in the shopper's currency, added up exactly as checkout adds it up, so the
 * amount to send matches what checkout showed: each line converted on its own (pieces in a Buy X
 * Get Y group as a whole line, the others unit price × quantity; free gifts 0), then the shipping
 * fee at the plain rate with no markup (`shippingEntry()`, ATS-311), each with `toDisplayAmount()`'s
 * rounding. Outside EGP it also keeps each line's amount, the shipping amount and the factors,
 * for the admin order page (ATS-304); rounded to the currency's decimals, they add up to `amount`.
 * Bank Transfer and Card both use it, so the two always cost the same (ATS-311).
 */
export function payInFor(
  lines: readonly Pick<OrderLinePrice, 'unitEgp' | 'quantity' | 'lineDisplay' | 'fullEgp' | 'gift'>[],
  shipping: Pick<OrderShippingLine, 'priceEgp'> | null,
  entry: CurrencyEntry,
): OrderPayIn {
  const decimals = displayDecimals(entry.code);
  const round = (value: number) => Number(value.toFixed(decimals));
  const lineAmounts = lines.map((line) => {
    if (line.gift) return 0;
    return round(
      line.fullEgp !== undefined
        ? toDisplayAmount(line.lineDisplay, entry)
        : toDisplayAmount(line.unitEgp, entry) * line.quantity,
    );
  });
  const shippingAmount = round(toDisplayAmount(shipping?.priceEgp ?? 0, shippingEntry(entry)));
  const amount = round(lineAmounts.reduce((sum, value) => sum + value, 0) + shippingAmount);
  if (entry.code === 'EGP') return { currency: entry.code, amount };
  return {
    currency: entry.code,
    amount,
    lines: lineAmounts,
    shipping: shippingAmount,
    factor: entry.factor,
    ...(isPositive(entry.shippingFactor) ? { shippingFactor: entry.shippingFactor } : {}),
  };
}

/** The abroad markup and rate behind a pay-in factor, saved staff-only in `orderStaffNotes`. */
export interface PayInRate {
  readonly markupPercent: number;
  /** Shopper currency per 1 EGP, before the markup. */
  readonly rate: number;
}

/**
 * The abroad markup and the rate before it that `factor` was built from (`intlPricing/config`
 * `markupPercent`, `intlPricing/rates` `rates[code]`), only when they rebuild `factor`
 * (`factor = rate × (1 + markup / 100)`, as `buildPublicCurrencyDoc()` does). Null otherwise, so
 * the admin page never shows a rate the shopper's amount wasn't worked out with.
 */
export function payInRateFor(
  entry: CurrencyEntry,
  markupPercent: number | null,
  rates: Readonly<Record<string, number>> | null,
): PayInRate | null {
  if (entry.code === 'EGP' || markupPercent === null || !rates) return null;
  const rate = rates[entry.code];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  const rebuilt = rate * (1 + markupPercent / 100);
  if (Math.abs(rebuilt - entry.factor) > entry.factor * 1e-9) return null;
  return { markupPercent, rate };
}

/**
 * The plain rate (shopper currency per 1 EGP, no markup) a Card charge abroad is turned back into
 * pounds with (ATS-311): the public `shippingFactor` checkout used, else the staff-only rate behind
 * the factor (`payInRateFor()`). Null when neither is known: Card abroad is then refused.
 */
export function plainRateFor(entry: CurrencyEntry, payInRate: PayInRate | null): number | null {
  if (entry.code === 'EGP') return 1;
  if (isPositive(entry.shippingFactor)) return entry.shippingFactor;
  return payInRate && isPositive(payInRate.rate) ? payInRate.rate : null;
}

/**
 * Whole pounds Paymob charges for an order abroad (ATS-311): the shopper-currency total
 * (`payIn.amount`, the same as Bank Transfer) at the plain rate, rounded up, so Card never comes
 * to less than Bank Transfer. Paymob Egypt charges in EGP only.
 */
export function cardChargeEgp(amount: number, plainRate: number): number {
  // toFixed first, so float noise (1145.0000000001) never adds a pound.
  return Math.ceil(Number((amount / plainRate).toFixed(6)));
}

export type AbroadPaymentMethod = 'bank-transfer' | 'paymob';

/**
 * The one calculation for an order shipped abroad, whatever the payment method (ATS-311): both
 * save `payIn` (what the shopper pays in their currency); Card also saves `chargeEgp`, what Paymob
 * charges in pounds. `totalEgp` stays the Egypt price. Null for Card when no plain rate is known.
 */
export function abroadPricing(
  pricing: OrderPricingSnapshot,
  entry: CurrencyEntry,
  method: AbroadPaymentMethod,
  payInRate: PayInRate | null,
): OrderPricingSnapshot | null {
  const payIn = payInFor(pricing.lines, pricing.shipping, entry);
  if (method === 'bank-transfer') return { ...pricing, payIn };
  const plainRate = plainRateFor(entry, payInRate);
  if (plainRate === null) return null;
  return { ...pricing, payIn, chargeEgp: cardChargeEgp(payIn.amount, plainRate) };
}

/**
 * True when the server's amount in the shopper's currency is higher than the total checkout showed
 * in that same currency (ATS-311): the factors changed after checkout read them, so the order is
 * refused rather than charge more. A missing shown amount, or one in another currency, never refuses.
 */
export function payInAboveShown(
  payIn: Pick<OrderPayIn, 'currency' | 'amount'>,
  shown: { readonly currency: string; readonly amount: number } | null,
): boolean {
  if (!shown || shown.currency !== payIn.currency) return false;
  const halfUnit = 0.5 * 10 ** -displayDecimals(payIn.currency);
  return payIn.amount > shown.amount + halfUnit;
}

/**
 * The saved `payIn` of an order abroad whose fee was to be agreed (`international-agreed`,
 * ATS-314), with the fee staff agreed (whole EGP) added as its shipping. The fee is converted at
 * the plain rate with no markup (ATS-311): the `shippingFactor` saved with the order, else
 * `fallbackPlainRate` (the staff-only rate behind its factor). The items keep the amounts saved at
 * Place Order; `amount` becomes items + shipping, rounded to the currency's decimals. Null when the
 * saved `payIn` can't be read, is in EGP, or no plain rate is known.
 */
export function payInWithAgreedShipping(
  saved: unknown,
  feeEgp: number,
  fallbackPlainRate: number | null,
): OrderPayIn | null {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  const raw = saved as Record<string, unknown>;
  const currency = raw['currency'];
  const amount = raw['amount'];
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) || currency === 'EGP') return null;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  const savedPlain = raw['shippingFactor'];
  const plainRate = isPositive(savedPlain)
    ? savedPlain
    : isPositive(fallbackPlainRate)
      ? fallbackPlainRate
      : null;
  if (plainRate === null) return null;
  const decimals = displayDecimals(currency);
  const round = (value: number) => Number(value.toFixed(decimals));
  const lines = Array.isArray(raw['lines']) ? raw['lines'] : null;
  const savedShipping =
    typeof raw['shipping'] === 'number' && Number.isFinite(raw['shipping']) ? raw['shipping'] : 0;
  const itemsAmount =
    lines && lines.every((value) => typeof value === 'number' && Number.isFinite(value))
      ? round((lines as number[]).reduce((sum, value) => sum + value, 0))
      : round(Math.max(0, amount - savedShipping));
  const shipping = round(toDisplayAmount(feeEgp, { code: currency, factor: plainRate }));
  return {
    ...(raw as unknown as OrderPayIn),
    currency,
    amount: round(itemsAmount + shipping),
    shipping,
    ...(isPositive(savedPlain) ? {} : { shippingFactor: plainRate }),
  };
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
