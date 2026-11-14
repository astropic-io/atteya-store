import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Runs against the compiled engine (`npm test` builds first); engine files import `./x.js`.
import { shopperMoney } from '../../../lib/offers/engine/index.js';

const lines = [
  { lineEgp: 360, wasEgp: null },
  { lineEgp: 0, wasEgp: null },
];

describe('shopperMoney (ATS-309)', () => {
  it('an Egypt order shows its EGP amounts', () => {
    const money = shopperMoney({
      abroad: false,
      lines,
      subtotalEgp: 360,
      shippingEgp: 115,
      totalEgp: 475,
      payIn: null,
    });
    assert.deepEqual(money, {
      currency: 'EGP',
      decimals: 0,
      lines: [360, 0],
      was: [null, null],
      subtotal: 360,
      shipping: 115,
      total: 475,
    });
  });

  it('an order abroad shows only the saved amounts in the shopper currency', () => {
    const money = shopperMoney({
      abroad: true,
      lines,
      subtotalEgp: 360,
      shippingEgp: 450,
      totalEgp: 810,
      payIn: { currency: 'QAR', amount: 78, lines: [35, 0], shipping: 43, factor: 0.096 },
    });
    assert.equal(money.currency, 'QAR');
    assert.deepEqual(money.lines, [35, 0]);
    assert.equal(money.subtotal, 35);
    assert.equal(money.shipping, 43);
    assert.equal(money.total, 78);
    assert.ok(![money.subtotal, money.shipping, money.total].includes(810));
  });

  it('converts the struck-out price with the factor the order was priced with', () => {
    const money = shopperMoney({
      abroad: true,
      lines: [{ lineEgp: 1000, wasEgp: 2000 }],
      subtotalEgp: 1000,
      shippingEgp: 0,
      totalEgp: 1000,
      payIn: { currency: 'USD', amount: 30, lines: [30], shipping: 0, factor: 0.03 },
    });
    assert.deepEqual(money.was, [60]);
  });

  it('an older order abroad that saved only its total shows the total alone', () => {
    const money = shopperMoney({
      abroad: true,
      lines,
      subtotalEgp: 360,
      shippingEgp: 450,
      totalEgp: 810,
      payIn: { currency: 'QAR', amount: 78 },
    });
    assert.deepEqual(money.lines, [null, null]);
    assert.equal(money.subtotal, null);
    assert.equal(money.shipping, null);
    assert.equal(money.total, 78);
  });

  it('saved lines that do not add up to the total are not shown', () => {
    const money = shopperMoney({
      abroad: true,
      lines,
      subtotalEgp: 360,
      shippingEgp: 450,
      totalEgp: 810,
      payIn: { currency: 'QAR', amount: 78, lines: [30, 0], shipping: 43 },
    });
    assert.deepEqual(money.lines, [null, null]);
    assert.equal(money.total, 78);
  });

  it('an order abroad with no usable amount in the shopper currency shows no amount, never EGP', () => {
    for (const payIn of [null, { currency: 'EGP', amount: 810 }, { currency: 'QAR', amount: 0 }]) {
      const money = shopperMoney({
        abroad: true,
        lines,
        subtotalEgp: 360,
        shippingEgp: 450,
        totalEgp: 810,
        payIn,
      });
      assert.notEqual(money.currency, 'EGP');
      assert.equal(money.total, null);
      assert.equal(money.subtotal, null);
      assert.equal(money.shipping, null);
      assert.deepEqual(money.lines, [null, null]);
    }
  });
});
