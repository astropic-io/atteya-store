import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toDisplayAmount } from '../../lib/offers/engine/currency.js';
import { payInEntry, payInFor, payInRateFor } from '../../lib/orders/pay-in.js';

const USD = { code: 'USD', factor: 0.0285 };

describe('payInEntry', () => {
  const currencies = {
    USD: { factor: 0.0285 },
    EUR: { factor: 0.026 },
    LBP: { factor: 2500 },
    GBP: { factor: 0 },
  };

  it('uses the currency checkout showed when it has a factor', () => {
    assert.deepEqual(payInEntry('EUR', currencies), { code: 'EUR', factor: 0.026 });
  });

  it('falls back to USD for a missing, unknown, unusable or EGP currency', () => {
    for (const requested of [null, 'XYZ', 'GBP', 'LBP']) {
      assert.deepEqual(payInEntry(requested, currencies), USD, String(requested));
    }
  });

  it('keeps EGP when checkout showed pounds, with no conversion', () => {
    assert.deepEqual(payInEntry('EGP', {}), { code: 'EGP', factor: 1 });
    assert.deepEqual(
      payInFor(
        [{ unitEgp: 1000, quantity: 2, lineDisplay: 2000 }],
        { priceEgp: 900 },
        { code: 'EGP', factor: 1 },
      ),
      {
        currency: 'EGP',
        amount: 2900,
      },
    );
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
