import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toDisplayAmount } from '../../lib/offers/engine/currency.js';
import {
  abroadPricing,
  cardChargeEgp,
  payInEntry,
  payInFor,
  payInRateFor,
  plainRateFor,
} from '../../lib/orders/pay-in.js';

const USD = { code: 'USD', factor: 0.0285 };

describe('payInEntry', () => {
  const currencies = {
    USD: { factor: 0.0285 },
    EUR: { factor: 0.026 },
    LBP: { factor: 2500 },
    GBP: { factor: 0 },
  };

  it("uses the delivery country's currency when it has a factor", () => {
    assert.deepEqual(payInEntry('EUR', currencies), { code: 'EUR', factor: 0.026 });
  });

  it('falls back to USD for a missing, unknown, unusable or EGP currency', () => {
    for (const requested of [null, 'XYZ', 'GBP', 'LBP']) {
      assert.deepEqual(payInEntry(requested, currencies), USD, String(requested));
    }
  });

  it('never pays in EGP: an order shipped abroad sends USD instead (ATS-309)', () => {
    assert.deepEqual(payInEntry('EGP', currencies), USD);
    assert.equal(payInEntry('EGP', {}), null);
  });

  it('is null when not even USD has a factor', () => {
    assert.equal(payInEntry('EUR', {}), null);
  });
});

describe('payInFor', () => {
  it('adds up each line and the shipping fee the way checkout does', () => {
    const lines = [
      { unitEgp: 1850, quantity: 2, lineDisplay: 3700 },
      // A Buy X Get Y line is converted as a whole.
      { unitEgp: 900, quantity: 2, lineDisplay: 900, fullEgp: 1800 },
      // Free gifts add nothing.
      {
        unitEgp: 0,
        quantity: 1,
        lineDisplay: 0,
        gift: { offerId: 'o', giftId: 'g', giftName: 'Free', forLine: 0 },
      },
    ];
    const expected = toDisplayAmount(1850, USD) * 2 + toDisplayAmount(900, USD) + toDisplayAmount(950, USD);
    assert.deepEqual(payInFor(lines, { priceEgp: 950 }, USD), {
      currency: 'USD',
      amount: expected,
      lines: [toDisplayAmount(1850, USD) * 2, toDisplayAmount(900, USD), 0],
      shipping: toDisplayAmount(950, USD),
      factor: USD.factor,
    });
  });

  it('keeps 3 decimals for KWD and free shipping adds 0', () => {
    const kwd = { code: 'KWD', factor: 0.0062 };
    const result = payInFor([{ unitEgp: 1000, quantity: 3, lineDisplay: 3000 }], { priceEgp: 0 }, kwd);
    assert.equal(result.currency, 'KWD');
    assert.equal(result.amount, Number((toDisplayAmount(1000, kwd) * 3).toFixed(3)));
    assert.deepEqual(result.lines, [result.amount]);
    assert.equal(result.shipping, 0);
  });

  it('saves line and shipping amounts that add up exactly to the amount', () => {
    const qar = { code: 'QAR', factor: 0.0955 };
    const lines = [
      { unitEgp: 999, quantity: 1, lineDisplay: 999 },
      { unitEgp: 1499, quantity: 2, lineDisplay: 2998 },
      { unitEgp: 750, quantity: 3, lineDisplay: 1500, fullEgp: 2250 },
    ];
    const result = payInFor(lines, { priceEgp: 750 }, qar);
    const sum = (result.lines ?? []).reduce((a, b) => a + b, 0) + (result.shipping ?? 0);
    assert.equal(sum, result.amount);
    assert.equal(result.lines?.length, lines.length);
  });

  it('line and shipping amounts round to the amount for 3-decimal currencies', () => {
    const bhd = { code: 'BHD', factor: 0.0108 };
    const lines = [
      { unitEgp: 1234, quantity: 3, lineDisplay: 3702 },
      { unitEgp: 877, quantity: 2, lineDisplay: 877, fullEgp: 1754 },
    ];
    const result = payInFor(lines, { priceEgp: 650 }, bhd);
    const sum = (result.lines ?? []).reduce((a, b) => a + b, 0) + (result.shipping ?? 0);
    assert.equal(Number(sum.toFixed(3)), result.amount);
  });

  it('adds no line amounts when paid in EGP', () => {
    const result = payInFor([{ unitEgp: 100, quantity: 1, lineDisplay: 100 }], null, {
      code: 'EGP',
      factor: 1,
    });
    assert.deepEqual(result, { currency: 'EGP', amount: 100 });
  });
});

describe('payInRateFor', () => {
  const rate = 0.0682;
  const qar = { code: 'QAR', factor: rate * 1.4 };

  it('returns the markup and rate that rebuild the factor', () => {
    assert.deepEqual(payInRateFor(qar, 40, { QAR: rate }), { markupPercent: 40, rate });
  });

  it('is null when the markup or rate changed since the factor was saved, or is missing', () => {
    assert.equal(payInRateFor(qar, 30, { QAR: rate }), null);
    assert.equal(payInRateFor(qar, 40, { QAR: 0.07 }), null);
    assert.equal(payInRateFor(qar, 40, { USD: 0.02 }), null);
    assert.equal(payInRateFor(qar, null, { QAR: rate }), null);
    assert.equal(payInRateFor(qar, 40, null), null);
    assert.equal(payInRateFor({ code: 'EGP', factor: 1 }, 40, { QAR: rate }), null);
  });
});

describe('shipping abroad gets no markup (ATS-311)', () => {
  const qar = { code: 'QAR', factor: 0.0682 * 1.4, shippingFactor: 0.0682 };

  it('payInEntry keeps the plain shipping rate when settings/currency has it', () => {
    assert.deepEqual(payInEntry('QAR', { QAR: { factor: 0.1, shippingFactor: 0.07 } }), {
      code: 'QAR',
      factor: 0.1,
      shippingFactor: 0.07,
    });
    assert.deepEqual(payInEntry('QAR', { QAR: { factor: 0.1, shippingFactor: 0 } }), {
      code: 'QAR',
      factor: 0.1,
    });
  });

  it('converts the shipping fee at the plain rate and the items with the markup', () => {
    const result = payInFor([{ unitEgp: 360, quantity: 1, lineDisplay: 360 }], { priceEgp: 450 }, qar);
    assert.equal(result.shipping, toDisplayAmount(450, { code: 'QAR', factor: 0.0682 }));
    assert.equal(result.shipping, 31);
    assert.deepEqual(result.lines, [toDisplayAmount(360, qar)]);
    assert.equal(result.shippingFactor, 0.0682);
    assert.equal(result.factor, qar.factor);
  });
});

describe('Card abroad costs the same as Bank Transfer (ATS-311)', () => {
  const pricingOf = (
    lines: Parameters<typeof payInFor>[0],
    shippingEgp: number,
  ): Parameters<typeof abroadPricing>[0] => {
    const subtotal = lines.reduce((sum, line) => sum + line.lineDisplay, 0);
    return {
      isInternational: true,
      shippingCountry: 'QA',
      currency: 'EGP',
      rate: 1,
      markupPercent: 0,
      ratesUpdatedAt: '',
      lines: lines as never,
      subtotalEgp: subtotal,
      subtotalDisplay: subtotal,
      shipping: { priceEgp: shippingEgp } as never,
      totalDisplay: subtotal + shippingEgp,
      totalEgp: subtotal + shippingEgp,
      fulfilment: {} as never,
    };
  };
  const bag = [
    { unitEgp: 1850, quantity: 2, lineDisplay: 3700 },
    // Buy X Get Y group line.
    { unitEgp: 900, quantity: 2, lineDisplay: 900, fullEgp: 1800 },
    // Free gift.
    {
      unitEgp: 0,
      quantity: 1,
      lineDisplay: 0,
      gift: { offerId: 'o', giftId: 'g', giftName: 'Free', forLine: 0 },
    },
  ];

  for (const entry of [
    { code: 'QAR', factor: 0.0682 * 1.4, shippingFactor: 0.0682 },
    { code: 'KWD', factor: 0.0062 * 1.4, shippingFactor: 0.0062 },
    { code: 'USD', factor: 0.0205 * 1.4, shippingFactor: 0.0205 },
  ]) {
    it(`gives both methods the same ${entry.code} amount, and Card charges it in pounds`, () => {
      const pricing = pricingOf(bag, 950);
      const bank = abroadPricing(pricing, entry, 'bank-transfer', null);
      const card = abroadPricing(pricing, entry, 'paymob', null);
      assert.ok(bank && card);
      assert.deepEqual(card.payIn, bank.payIn);
      assert.equal(bank.chargeEgp, undefined);
      // Egypt price untouched.
      assert.equal(card.totalEgp, pricing.totalEgp);
      const amount = card.payIn!.amount;
      assert.equal(card.chargeEgp, Math.ceil(Number((amount / entry.shippingFactor).toFixed(6))));
      // Rounded up to whole pounds, never under the shopper-currency total.
      assert.ok(Number.isInteger(card.chargeEgp));
      assert.ok(card.chargeEgp! * entry.shippingFactor >= amount - 1e-9);
      assert.ok((card.chargeEgp! - 1) * entry.shippingFactor < amount);
    });
  }

  it('matches the ticket example: QAR 78 at 14.68 EGP per QAR is EGP 1,146 at most', () => {
    assert.equal(cardChargeEgp(78, 1 / 14.68), 1146);
    assert.equal(cardChargeEgp(100, 0.1), 1000);
  });

  it('turns back with the staff rate when settings/currency has no plain rate yet', () => {
    const entry = { code: 'QAR', factor: 0.0682 * 1.4 };
    assert.equal(plainRateFor(entry, { markupPercent: 40, rate: 0.0682 }), 0.0682);
    assert.equal(plainRateFor(entry, null), null);
    const pricing = pricingOf(bag, 0);
    assert.equal(abroadPricing(pricing, entry, 'paymob', null), null);
    assert.ok(abroadPricing(pricing, entry, 'bank-transfer', null));
  });
});
