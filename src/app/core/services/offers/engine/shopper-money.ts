// GENERATED — edit functions/src/offers/engine
import { displayDecimals, toDisplayAmount } from './currency';

/**
 * The amounts a SHOPPER sees for a saved order (order page, Account → Orders, order emails;
 * ATS-309). Pure: no Firebase, no Angular.
 *
 * An Egypt order shows its saved EGP amounts, as before. An order shipped abroad never shows EGP
 * or the Egypt price: every amount comes from the order's own `pricing.payIn` (the currency the
 * shopper pays in), saved by the server. An abroad order that saved only the total shows the
 * total alone; one with no `payIn` at all (or one in EGP, from before ATS-309) shows no amount.
 * Staff pages and staff emails keep EGP and never use this.
 */

/** One saved order line, as much as the shopper amounts need. */
export interface ShopperMoneyLine {
  /** The line after its Buy X Get Y discount, in whole EGP (0 for a free gift). */
  readonly lineEgp: number;
  /** The line before its Buy X Get Y discount, in whole EGP, when it had one; else null. */
  readonly wasEgp: number | null;
}

/** The saved `pricing.payIn`, as much as the shopper amounts need. */
export interface ShopperMoneyPayIn {
  readonly currency: string;
  readonly amount: number;
  readonly lines?: readonly number[];
  readonly shipping?: number;
  readonly factor?: number;
}

export interface ShopperMoneyInput {
  /** True when the order ships outside Egypt (`pricing.isInternational` / country not `EG`). */
  readonly abroad: boolean;
  readonly lines: readonly ShopperMoneyLine[];
  readonly subtotalEgp: number;
  readonly shippingEgp: number;
  readonly totalEgp: number;
  readonly payIn: ShopperMoneyPayIn | null | undefined;
}

export interface ShopperMoney {
  /** `EGP` for an Egypt order, else the currency the shopper pays in. */
  readonly currency: string;
  /** Decimals to show (`displayDecimals()`). */
  readonly decimals: number;
  /** Each line's amount, index-matched to the input lines; null = no price to show. */
  readonly lines: readonly (number | null)[];
  /** Each line's amount before its Buy X Get Y discount; null = no struck-out price. */
  readonly was: readonly (number | null)[];
  /** Null = don't show the row (an abroad order that saved only its total). */
  readonly subtotal: number | null;
  readonly shipping: number | null;
  /** Null = no amount at all (an abroad order with no usable `payIn`). */
  readonly total: number | null;
}

export function shopperMoney(input: ShopperMoneyInput): ShopperMoney {
  if (!input.abroad) {
    return {
      currency: 'EGP',
      decimals: 0,
      lines: input.lines.map((line) => line.lineEgp),
      was: input.lines.map((line) => line.wasEgp),
      subtotal: input.subtotalEgp,
      shipping: input.shippingEgp,
      total: input.totalEgp,
    };
  }
  const payIn = usablePayIn(input.payIn);
  const none = input.lines.map(() => null);
  if (!payIn) {
    return {
      currency: input.payIn && input.payIn.currency !== 'EGP' ? input.payIn.currency : 'USD',
      decimals: 0,
      lines: none,
      was: none,
      subtotal: null,
      shipping: null,
      total: null,
    };
  }
  const decimals = displayDecimals(payIn.currency);
  const round = (value: number) => Number(value.toFixed(decimals));
  const saved = payIn.lines;
  const linesSaved =
    saved !== undefined &&
    payIn.shipping !== undefined &&
    saved.length === input.lines.length &&
    saved.every((value) => Number.isFinite(value) && value >= 0) &&
    Number.isFinite(payIn.shipping) &&
    payIn.shipping >= 0 &&
    Math.abs(round(saved.reduce((sum, value) => sum + value, 0) + payIn.shipping) - payIn.amount) <
      10 ** -decimals / 2;
  if (!linesSaved) {
    return {
      currency: payIn.currency,
      decimals,
      lines: none,
      was: none,
      subtotal: null,
      shipping: null,
      total: payIn.amount,
    };
  }
  const entry = payIn.factor && payIn.factor > 0 ? { code: payIn.currency, factor: payIn.factor } : null;
  const shipping = payIn.shipping ?? 0;
  return {
    currency: payIn.currency,
    decimals,
    lines: saved,
    // The price before a Buy X Get Y discount, converted with the factor the order was priced with.
    was: input.lines.map((line) =>
      entry && line.wasEgp !== null && line.wasEgp > line.lineEgp
        ? round(toDisplayAmount(line.wasEgp, entry))
        : null,
    ),
    subtotal: round(payIn.amount - shipping),
    shipping,
    total: payIn.amount,
  };
}

/** A saved `payIn` in a currency other than EGP with a positive amount, else null. */
function usablePayIn(payIn: ShopperMoneyPayIn | null | undefined): ShopperMoneyPayIn | null {
  if (!payIn || !/^[A-Z]{3}$/.test(payIn.currency) || payIn.currency === 'EGP') return null;
  return Number.isFinite(payIn.amount) && payIn.amount > 0 ? payIn : null;
}
