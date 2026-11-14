import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Runs against the compiled code (`npm test` builds first).
import { toDisplayAmount } from '../../lib/offers/engine/index.js';
import {
  CARD_AGREED_ABROAD_MESSAGE,
  isAgreedShippingKind,
  missedOrderTotal,
  planOrderDelivery,
  quoteShippingLine,
} from '../../lib/orders/order-pricing.server.js';
import { payInWithAgreedShipping } from '../../lib/orders/pay-in.js';
import { parseCheckoutShippingConfig } from '../../lib/shipping/shipping-settings.js';
import { isDeliveryFeeToBeAgreed, orderStage } from '../../lib/store/order-messages.js';

const CTX = { now: new Date('2026-11-14T12:00:00Z'), signedIn: false, codes: [] };
/** Nothing saved: the default Delivery Countries (16) and the placeholder abroad boxes (up to 10 kg). */
const SETTINGS = parseCheckoutShippingConfig(undefined).settings;
const TEE = [{ weightGrams: 250, quantity: 1 }];
const HEAVY = [{ weightGrams: 10_001, quantity: 1 }];

function line(country: string, parcel: typeof TEE, paymentMethod: string, settings = SETTINGS) {
  const isInternational = country !== 'EG';
  return quoteShippingLine(planOrderDelivery(settings, country, parcel), {
    settings,
    region: isInternational ? 'international' : 'egypt',
    isInternational,
    paymentMethod: paymentMethod as never,
    subtotalEgp: 500,
    cartProducts: [],
    offers: [],
    ctx: CTX,
    governorateExtraEgp: 0,
  }).line;
}

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

describe('orders from any country (ATS-314)', () => {
  it('a listed country gets the abroad box fee', () => {
    const shipping = line('AE', TEE, 'bank-transfer');
    assert.equal(shipping.kind, 'international-box');
    assert.equal(shipping.boxId, 'box1');
    assert.equal(shipping.priceEgp, 450);
  });

  it('a country not on the list is placed with delivery and the fee to be agreed', () => {
    const shipping = line('BR', TEE, 'bank-transfer');
    assert.deepEqual(shipping, {
      kind: 'international-agreed',
      boxId: null,
      priceEgp: 0,
      priceDisplay: 0,
      feeAgreed: false,
    });
    assert.ok(isAgreedShippingKind(shipping.kind));
    assert.ok(isDeliveryFeeToBeAgreed(shipping));
  });

  it('a listed country heavier than every abroad box is to be agreed too, never refused', () => {
    assert.equal(line('US', HEAVY, 'bank-transfer').kind, 'international-agreed');
  });

  it('the saved list decides, not the default one', () => {
    const settings = parseCheckoutShippingConfig({ deliveryCountries: ['BR'] }).settings;
    assert.equal(line('BR', TEE, 'bank-transfer', settings).kind, 'international-box');
    assert.equal(line('AE', TEE, 'bank-transfer', settings).kind, 'international-agreed');
    // Egypt is never on the list and still uses its own boxes.
    const egypt = parseCheckoutShippingConfig({ deliveryCountries: ['EG'] }).settings;
    assert.deepEqual(egypt.deliveryCountries, []);
  });

  it('Card is refused for both, with the checkout wording', () => {
    assert.equal(
      refusal(() => line('BR', TEE, 'paymob')),
      CARD_AGREED_ABROAD_MESSAGE,
    );
    assert.equal(
      refusal(() => line('US', HEAVY, 'paymob')),
      CARD_AGREED_ABROAD_MESSAGE,
    );
    assert.equal(line('AE', TEE, 'paymob').kind, 'international-box');
  });

  it('checkout sends the items total with no fee: compared like a large Egypt order', () => {
    const agreed = { kind: 'international-agreed' as const, priceEgp: 0 };
    assert.equal(missedOrderTotal({ shownShippingEgp: null, shownTotalEgp: 500 }, agreed, 500), null);
    assert.deepEqual(missedOrderTotal({ shownShippingEgp: null, shownTotalEgp: 500 }, agreed, 600), {
      missedTotalEgp: 600,
      shippingEgp: 0,
    });
    // Checkout showed a set fee (the country was on the list then): refused, never placed silently.
    assert.deepEqual(missedOrderTotal({ shownShippingEgp: 450, shownTotalEgp: 950 }, agreed, 500), {
      missedTotalEgp: 500,
      shippingEgp: 0,
    });
  });

  it('the order waits for the fee: nothing to send until staff set it', () => {
    const base = {
      ref: '#A1B2C3',
      paymentMethod: 'bank-transfer',
      status: 'pending',
      country: 'BR',
      shippingEgp: null,
      totalEgp: null,
      needsReview: false,
      payIn: { currency: 'BRL', amount: 120 },
    };
    assert.equal(orderStage({ ...base, feeToBeAgreed: true }), 'fee-to-be-agreed');
    assert.equal(orderStage({ ...base, feeToBeAgreed: false }), 'bank-transfer-due');
  });
});

describe('Set Delivery Fee on an order abroad (ATS-314)', () => {
  const saved = {
    currency: 'USD',
    amount: 21,
    lines: [12, 9, 0],
    shipping: 0,
    factor: 0.028,
    shippingFactor: 0.02,
  };

  it('converts the fee at the plain rate with no markup and updates payIn.amount', () => {
    const payIn = payInWithAgreedShipping(saved, 750, null);
    const shipping = toDisplayAmount(750, { code: 'USD', factor: 0.02 });
    assert.ok(payIn);
    assert.equal(payIn.shipping, shipping);
    assert.equal(payIn.amount, 21 + shipping);
    assert.deepEqual(payIn.lines, [12, 9, 0]);
    assert.equal(payIn.factor, 0.028);
    // Not the item factor (with the markup).
    assert.notEqual(payIn.shipping, toDisplayAmount(750, { code: 'USD', factor: 0.028 }));
  });

  it('a later change replaces the fee, never adds to it', () => {
    const first = payInWithAgreedShipping(saved, 750, null);
    const changed = payInWithAgreedShipping(first, 0, null);
    assert.ok(changed);
    assert.equal(changed.shipping, 0);
    assert.equal(changed.amount, 21);
  });

  it('falls back to the staff-only rate, then the saved factor, and never saves the rate used', () => {
    const { shippingFactor: _plain, ...withoutPlain } = saved;
    const payIn = payInWithAgreedShipping(withoutPlain, 750, 0.02);
    assert.ok(payIn);
    assert.equal(payIn.shippingFactor, undefined);
    assert.equal(payIn.shipping, toDisplayAmount(750, { code: 'USD', factor: 0.02 }));
    const old = payInWithAgreedShipping(withoutPlain, 750, null);
    assert.ok(old);
    assert.equal(old.shipping, toDisplayAmount(750, { code: 'USD', factor: 0.028 }));
    assert.equal(payInWithAgreedShipping({ currency: 'EGP', amount: 500 }, 750, 1), null);
    assert.equal(payInWithAgreedShipping(null, 750, 0.02), null);
  });

  it('3-decimal currencies round to 3 places', () => {
    const payIn = payInWithAgreedShipping(
      {
        currency: 'KWD',
        amount: 3.1,
        lines: [1.7, 1.4],
        shipping: 0,
        factor: 0.0087,
        shippingFactor: 0.0062,
      },
      750,
      null,
    );
    assert.ok(payIn);
    const shipping = toDisplayAmount(750, { code: 'KWD', factor: 0.0062 });
    assert.equal(payIn.amount, Number((3.1 + shipping).toFixed(3)));
  });
});
