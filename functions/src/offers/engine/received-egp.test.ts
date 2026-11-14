import assert from 'node:assert/strict';
import { test } from 'node:test';
// Runs against the compiled engine (`npm test` builds first).
import { receivedEgp } from '../../../lib/offers/engine/received-egp.js';

test('Egypt order keeps the Egypt total', () => {
  assert.equal(receivedEgp({ subtotalEgp: 900, totalEgp: 950 }), 950);
  assert.equal(receivedEgp({ totalEgp: 950, payIn: { currency: 'EGP', amount: 950 } }), 950);
});

test('Card abroad counts the pounds Paymob charged', () => {
  assert.equal(
    receivedEgp({ totalEgp: 950, chargeEgp: 1200, payIn: { currency: 'USD', amount: 24, factor: 0.022 } }),
    1200,
  );
});

test('Bank Transfer abroad converts at the saved plain rate', () => {
  assert.equal(
    receivedEgp({
      totalEgp: 950,
      payIn: { currency: 'USD', amount: 24, factor: 0.025, shippingFactor: 0.02 },
    }),
    1200,
  );
});

test('Bank Transfer from before the plain rate uses the saved factor', () => {
  assert.equal(receivedEgp({ totalEgp: 950, payIn: { currency: 'USD', amount: 25, factor: 0.025 } }), 1000);
});

test('abroad order with nothing to convert falls back to the Egypt total', () => {
  assert.equal(receivedEgp({ totalEgp: 950, payIn: { currency: 'USD', amount: 24 } }), 950);
  assert.equal(receivedEgp({ subtotalEgp: 900 }), 900);
  assert.equal(receivedEgp(null), 0);
  assert.equal(receivedEgp({}), 0);
});
