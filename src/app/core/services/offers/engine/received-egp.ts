// GENERATED — edit functions/src/offers/engine
/**
 * The pounds the store actually receives for a saved order (ATS-316), for staff and ads reporting
 * (the customer's total spent, the Meta Pixel Purchase value). Never shown to a shopper.
 *
 * - Card abroad: `chargeEgp`, the whole pounds Paymob charged.
 * - Bank Transfer abroad: `payIn.amount` turned back into pounds at the plain rate saved on the
 *   order (`payIn.shippingFactor`, else the public `payIn.factor` for an order from before ATS-311),
 *   rounded to a whole pound.
 * - Everything else (Egypt, or an abroad order without enough saved to convert): `totalEgp`, else
 *   the items total.
 */
export interface ReceivedEgpPricing {
  readonly subtotalEgp?: number | null;
  readonly totalEgp?: number | null;
  readonly chargeEgp?: number | null;
  readonly payIn?: {
    readonly currency?: string | null;
    readonly amount?: number | null;
    readonly factor?: number | null;
    readonly shippingFactor?: number | null;
  } | null;
}

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Whole pounds the store receives for the order, or 0 when the snapshot holds no usable price. */
export function receivedEgp(pricing: ReceivedEgpPricing | null | undefined): number {
  if (!pricing) return 0;
  if (isPositive(pricing.chargeEgp)) return pricing.chargeEgp;
  const payIn = pricing.payIn;
  if (payIn && payIn.currency !== 'EGP' && isPositive(payIn.amount)) {
    const rate = isPositive(payIn.shippingFactor) ? payIn.shippingFactor : payIn.factor;
    if (isPositive(rate)) return Math.round(payIn.amount / rate);
  }
  // A total of 0 (a fully discounted order) stays 0; only a missing total falls back to the items.
  if (typeof pricing.totalEgp === 'number' && Number.isFinite(pricing.totalEgp) && pricing.totalEgp >= 0) {
    return pricing.totalEgp;
  }
  return isPositive(pricing.subtotalEgp) ? pricing.subtotalEgp : 0;
}
