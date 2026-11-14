import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { markupOrDefault, readStoredRates } from '../intl/exchange-rates.js';
import type { OrderPricingSnapshot } from './order-pricing.server.js';
import type { ShownPayIn } from './order-request.js';
import {
  abroadPricing,
  payInAboveShown,
  payInEntry,
  payInRateFor,
  type AbroadPaymentMethod,
  type PayInRate,
} from './pay-in.js';

/**
 * The pricing of an order shipped abroad, for Bank Transfer and Card alike (ATS-311): the amount in
 * the shopper's currency from the public `settings/currency` factors (the same ones checkout
 * converted with) and, for Card, the pounds Paymob charges. It also returns the markup and rate
 * the factor was built from (read in the same `getAll`), for the staff-only notes, so staff see
 * what the order comes to in pounds (ATS-304). The rate never changes the shopper's amount, and it
 * is null when it can't be read or no longer rebuilds the factor. Refused (`details.payInChanged`)
 * when the amount comes out higher than the total checkout showed (`shown`): checkout reads the
 * factors again and shows the new total. The refusal carries the amount (`details.payIn`).
 */
export async function withPayIn(
  db: Firestore,
  pricing: OrderPricingSnapshot,
  requested: string | null,
  method: AbroadPaymentMethod,
  shown: ShownPayIn | null,
): Promise<{ pricing: OrderPricingSnapshot; payInRate: PayInRate | null }> {
  const [snap, configSnap, ratesSnap] = await db.getAll(
    db.doc('settings/currency'),
    db.doc('intlPricing/config'),
    db.doc('intlPricing/rates'),
  );
  const currencies = snap.get('currencies');
  const entry = payInEntry(requested, isRecord(currencies) ? currencies : {});
  if (!entry) throw cantWorkOutAmount();
  const payInRate = payInRateFor(
    entry,
    markupOrDefault(configSnap.data()),
    readStoredRates(ratesSnap.data()),
  );
  const priced = abroadPricing(pricing, entry, method, payInRate);
  if (!priced) throw cantWorkOutAmount();
  if (priced.payIn && payInAboveShown(priced.payIn, shown)) {
    throw new HttpsError(
      'failed-precondition',
      'Prices in your currency were just updated. Check the new total, then place your order again.',
      // The amount itself, so checkout can show it when it can't add the order up line by line
      // the way `payInFor()` does (the server's own totals after a refusal).
      { payInChanged: true, payIn: { currency: priced.payIn.currency, amount: priced.payIn.amount } },
    );
  }
  return { pricing: priced, payInRate };
}

function cantWorkOutAmount(): HttpsError {
  return new HttpsError(
    'unavailable',
    "We couldn't work out the amount in your currency. Please try again in a moment.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
