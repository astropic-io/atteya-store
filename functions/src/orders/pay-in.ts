import {
  displayDecimals,
  isUnreliableCurrency,
  toDisplayAmount,
  type CurrencyEntry,
} from '../offers/engine/currency.js';
import type { OrderLinePrice, OrderPayIn, OrderShippingLine } from './order-pricing.server.js';

/** The currency a Bank Transfer falls back to when checkout sent none or one we can't use. */
export const PAY_IN_FALLBACK_CURRENCY = 'USD';

/**
 * The currency a Bank Transfer order is paid in: the one checkout showed (`requested`) when
 * `settings/currency` has a usable factor for it, else USD. EGP (a visitor whose prices show in
 * pounds, shipping abroad) stays EGP with no conversion, so the amount is the total checkout
 * showed. Null when neither has a factor (the order is then refused: we can't say how much to send).
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
    return typeof factor === 'number' && Number.isFinite(factor) && factor > 0 ? { code, factor } : null;
  };
  if (requested === 'EGP') return { code: 'EGP', factor: 1 };
  return usable(requested) ?? usable(PAY_IN_FALLBACK_CURRENCY);
}

/**
 * The order total in the shopper's currency, added up exactly as checkout adds it up, so the
 * amount to send matches what checkout showed: each line converted on its own (pieces in a Buy X
 * Get Y group as a whole line, the others unit price × quantity; free gifts 0), then the shipping
 * fee, each with `toDisplayAmount()`'s rounding. Outside EGP it also keeps each line's amount,
 * the shipping amount and the factor, for the admin order page (ATS-304); they add up to `amount`.
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
  const shippingAmount = round(toDisplayAmount(shipping?.priceEgp ?? 0, entry));
  const amount = round(lineAmounts.reduce((sum, value) => sum + value, 0) + shippingAmount);
  if (entry.code === 'EGP') return { currency: entry.code, amount };
  return {
    currency: entry.code,
    amount,
    lines: lineAmounts,
    shipping: shippingAmount,
    factor: entry.factor,
  };
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
): { readonly markupPercent: number; readonly rate: number } | null {
  if (entry.code === 'EGP' || markupPercent === null || !rates) return null;
  const rate = rates[entry.code];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  const rebuilt = rate * (1 + markupPercent / 100);
  if (Math.abs(rebuilt - entry.factor) > entry.factor * 1e-9) return null;
  return { markupPercent, rate };
}
