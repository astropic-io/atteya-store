import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Runs against the compiled code (`npm test` builds first).
import { customerOrderFrom } from '../../lib/customers/customer-summary.js';
import { readOrderForEmail } from '../../lib/email/order-email-model.js';
import {
  PAID_FROM_ABROAD_TOO_HEAVY_MESSAGE,
  planOrderDelivery,
  quoteShippingLine,
} from '../../lib/orders/order-pricing.server.js';
import { currencyFromCountry } from '../../lib/intl/currency-from-country.js';
import {
  PAID_FROM_ABROAD_METHOD_MESSAGE,
  parseCreateStoreOrderRequest,
  payInCountryOf,
} from '../../lib/orders/order-request.js';
import { assertConfirmable } from '../../lib/orders/order-status-change.js';
import { orderSearchTokens } from '../../lib/store/order-search.js';
import { payInFor } from '../../lib/orders/pay-in.js';
import { returnEligibility } from '../../lib/store/returns.js';
import { parseCheckoutShippingConfig } from '../../lib/shipping/shipping-settings.js';
import {
  ABROAD_PHONE_MESSAGE,
  EGYPT_PHONE_MESSAGE,
  orderStage,
  PAYER_FIELD_MESSAGES,
} from '../../lib/store/order-messages.js';

/**
 * A shopper outside Egypt pays for an order delivered to someone in Egypt: the recipient's Egypt
 * address and mobile, the shopper as `payer`, items at abroad prices in the payer's currency,
 * the Egypt delivery fee (box + governorate), Bank Transfer only.
 */

const LINES = [{ productId: 'tee-black', variantId: null, quantity: 2 }];
const RECIPIENT = {
  fullName: 'Omar Khaled',
  line1: '12 El Tahrir St, Dokki',
  line2: null,
  city: '',
  region: null,
  postalCode: '',
  country: 'EG',
  phone: '010 1234 5678',
  governorateId: 'giza',
};
const PAYER = { fullName: 'Sara Mahmoud', phone: '+1 917 555 0142', country: 'US' };

function request(overrides: Record<string, unknown> = {}) {
  return { lines: LINES, paymentMethod: 'bank-transfer', shipping: RECIPIENT, payer: PAYER, ...overrides };
}

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

describe('paid from abroad, delivered in Egypt: the order request', () => {
  it('accepts an Egypt address with a payer abroad and Bank Transfer', () => {
    const parsed = parseCreateStoreOrderRequest(request());
    assert.equal(parsed.shipping.country, 'EG');
    assert.equal(parsed.shipping.governorateId, 'giza');
    assert.equal(parsed.paymentMethod, 'bank-transfer');
    assert.deepEqual(parsed.payer, PAYER);
  });

  it("pays in the payer's currency, never the recipient's EGP", () => {
    assert.equal(currencyFromCountry(payInCountryOf(parseCreateStoreOrderRequest(request()))), 'USD');
    const uk = { ...PAYER, country: 'GB', phone: '+44 7700 900123' };
    assert.equal(
      currencyFromCountry(payInCountryOf(parseCreateStoreOrderRequest(request({ payer: uk })))),
      'GBP',
    );
  });

  it('leaves payer null on every other order', () => {
    const parsed = parseCreateStoreOrderRequest(request({ payer: undefined, paymentMethod: 'instapay' }));
    assert.equal(parsed.payer, null);
  });

  it('is Bank Transfer only', () => {
    for (const method of ['instapay', 'cash-on-delivery', 'paymob']) {
      assert.equal(
        refusal(() => parseCreateStoreOrderRequest(request({ paymentMethod: method }))),
        PAID_FROM_ABROAD_METHOD_MESSAGE,
      );
    }
  });

  it('still refuses Bank Transfer to an Egypt address without a payer', () => {
    assert.match(
      refusal(() => parseCreateStoreOrderRequest(request({ payer: null }))),
      /only available for orders delivered outside Egypt/,
    );
  });

  it('refuses a payer on an address abroad', () => {
    const shipping = { ...RECIPIENT, country: 'AE', city: 'Dubai', phone: '+971 50 123 4567' };
    assert.notEqual(
      refusal(() => parseCreateStoreOrderRequest(request({ shipping }))),
      '',
    );
  });

  it('needs the payer to be outside Egypt, with a name and a number with its country code', () => {
    assert.equal(
      refusal(() => parseCreateStoreOrderRequest(request({ payer: { ...PAYER, country: 'EG' } }))),
      PAYER_FIELD_MESSAGES.country,
    );
    assert.equal(
      refusal(() => parseCreateStoreOrderRequest(request({ payer: { ...PAYER, fullName: ' ' } }))),
      PAYER_FIELD_MESSAGES.fullName,
    );
    assert.equal(
      refusal(() => parseCreateStoreOrderRequest(request({ payer: { ...PAYER, phone: '917 555 0142' } }))),
      ABROAD_PHONE_MESSAGE,
    );
  });

  it("needs the recipient's Egyptian mobile and governorate", () => {
    assert.equal(
      refusal(() =>
        parseCreateStoreOrderRequest(request({ shipping: { ...RECIPIENT, phone: '+1 917 555 0142' } })),
      ),
      EGYPT_PHONE_MESSAGE,
    );
    assert.equal(
      refusal(() =>
        parseCreateStoreOrderRequest(request({ shipping: { ...RECIPIENT, governorateId: null } })),
      ),
      'Choose your governorate.',
    );
  });
});

describe('paid from abroad, delivered in Egypt: pricing', () => {
  const CTX = { now: new Date('2026-11-26T12:00:00Z'), signedIn: false, codes: [] };
  const SETTINGS = parseCheckoutShippingConfig(undefined).settings;

  function egyptLine(parcel: { weightGrams: number; quantity: number }[]) {
    return quoteShippingLine(planOrderDelivery(SETTINGS, 'EG', parcel), {
      settings: SETTINGS,
      region: 'egypt',
      isInternational: false,
      paymentMethod: 'bank-transfer',
      subtotalEgp: 1300,
      cartProducts: [],
      offers: [],
      ctx: CTX,
      governorateExtraEgp: 10,
      countryExtraEgp: 0,
    }).line;
  }

  it('charges the Egypt box fee plus the governorate extra', () => {
    const shipping = egyptLine([{ weightGrams: 250, quantity: 2 }]);
    assert.equal(shipping.kind, 'domestic-box');
    assert.equal(shipping.priceEgp, 125);
  });

  it('refuses an order heavier than every Egypt box (its fee would be agreed later)', () => {
    assert.equal(
      refusal(() => egyptLine([{ weightGrams: 50_000, quantity: 1 }])),
      PAID_FROM_ABROAD_TOO_HEAVY_MESSAGE,
    );
  });

  it('items keep the abroad markup, the Egypt delivery fee is converted at the plain rate', () => {
    // 1 USD = 48 EGP, abroad markup 40%: two T-shirts at EGP 650 = $38, Giza delivery EGP 125 = $3.
    const entry = { code: 'USD', factor: 1.4 / 48, shippingFactor: 1 / 48 };
    const payIn = payInFor(
      [{ unitEgp: 650, quantity: 2, lineDisplay: 1300, gift: undefined } as never],
      { priceEgp: 125 },
      entry,
    );
    assert.equal(payIn.currency, 'USD');
    assert.deepEqual(payIn.lines, [38]);
    assert.equal(payIn.shipping, 3);
    assert.equal(payIn.amount, 41);
  });
});

describe('paid from abroad, delivered in Egypt: after Place Order', () => {
  const ORDER = {
    paymentMethod: 'bank-transfer',
    status: 'pending',
    customerEmail: 'sara@example.com',
    shipping: { ...RECIPIENT, city: 'Giza' },
    payer: PAYER,
    pricing: {
      isInternational: false,
      shippingCountry: 'EG',
      paidFromCountry: 'US',
      lines: [
        {
          productId: 'tee-black',
          name: 'Tee',
          quantity: 2,
          unitEgp: 650,
          unitDisplay: 650,
          lineDisplay: 1300,
        },
      ],
      subtotalEgp: 1300,
      subtotalDisplay: 1300,
      shipping: { kind: 'domestic-box', boxId: 'box1', priceEgp: 125, priceDisplay: 125 },
      totalEgp: 1425,
      totalDisplay: 1425,
      fulfilment: 'international-bank-transfer',
      payIn: {
        currency: 'USD',
        amount: 41,
        lines: [38],
        shipping: 3,
        factor: 1.4 / 48,
        shippingFactor: 1 / 48,
      },
    },
  };

  it('staff can confirm it, but not a Bank Transfer to Egypt that was not paid from abroad', () => {
    assert.doesNotThrow(() => assertConfirmable(ORDER));
    const { paidFromCountry: _dropped, ...pricing } = ORDER.pricing;
    assert.throws(() => assertConfirmable({ ...ORDER, pricing }), /paid from abroad/);
  });

  it('staff find it by the payer too', () => {
    const tokens = orderSearchTokens({
      orderId: 'abcdef123456',
      fullName: 'Omar Khaled Sara Mahmoud',
      phone: RECIPIENT.phone,
      otherPhone: PAYER.phone,
      email: null,
    });
    assert.ok(tokens.includes('sara'));
    assert.ok(tokens.includes('0142'));
    assert.ok(tokens.includes('5678'));
  });

  it('waits for the Bank Transfer, like an order from abroad', () => {
    const stage = orderStage({
      ref: '#ABCDEF',
      paymentMethod: 'bank-transfer',
      status: 'pending',
      country: 'US',
      shippingEgp: 125,
      totalEgp: 1425,
      needsReview: false,
      payIn: { currency: 'USD', amount: 41 },
    });
    assert.equal(stage, 'bank-transfer-due');
  });

  it("emails show the shopper's currency and greet the payer, not the recipient", () => {
    const order = readOrderForEmail('abcdef123456', ORDER);
    assert.ok(order);
    assert.equal(order.isInternational, false);
    assert.equal(order.paysInOtherCurrency, true);
    assert.equal(order.paidFromCountry, 'US');
    assert.deepEqual(order.payer, PAYER);
    assert.equal(order.shopper.currency, 'USD');
    assert.equal(order.shopper.total, 41);
    assert.equal(order.address.fullName, 'Omar Khaled');
  });

  it('the customer is the payer', () => {
    const customer = customerOrderFrom('o1', ORDER, null);
    assert.equal(customer.fullName, 'Sara Mahmoud');
    assert.equal(customer.phone, '+1 917 555 0142');
    assert.equal(customer.country, 'US');
  });

  it('returns are asked for on WhatsApp, like an order abroad', () => {
    const eligibility = returnEligibility(
      { status: 'delivered', deliveredAtMs: Date.now(), isInternational: true, returns: [] },
      Date.now(),
    );
    assert.equal(eligibility.ok, false);
  });
});
