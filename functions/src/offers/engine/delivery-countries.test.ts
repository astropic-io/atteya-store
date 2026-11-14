import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Runs against the compiled code (`npm test` builds first).
import {
  DEFAULT_DELIVERY_COUNTRIES,
  DELIVERY_COUNTRY_CODES,
  hasSetShippingPrice,
  isDeliveryCountry,
  parseDeliveryCountries,
  setPriceCountries,
} from '../../../lib/offers/engine/delivery-countries.js';

describe('delivery countries (ATS-314)', () => {
  it('every country can be ordered to, Egypt included; made-up codes cannot', () => {
    assert.ok(isDeliveryCountry('EG'));
    assert.ok(isDeliveryCountry('BR'));
    assert.ok(isDeliveryCountry('XK'));
    assert.ok(!isDeliveryCountry('EU'));
    assert.ok(!isDeliveryCountry('ZZ'));
    assert.ok(!isDeliveryCountry('eg'));
    assert.equal(new Set(DELIVERY_COUNTRY_CODES).size, DELIVERY_COUNTRY_CODES.length);
  });

  it('nothing saved: the 16 countries checkout offered before', () => {
    assert.equal(DEFAULT_DELIVERY_COUNTRIES.length, 16);
    assert.deepEqual(setPriceCountries({}), DEFAULT_DELIVERY_COUNTRIES);
    assert.ok(hasSetShippingPrice({}, 'AE'));
    assert.ok(!hasSetShippingPrice({}, 'BR'));
  });

  it('a saved list decides; Egypt always has a set price', () => {
    const settings = { deliveryCountries: ['BR'] };
    assert.ok(hasSetShippingPrice(settings, 'BR'));
    assert.ok(!hasSetShippingPrice(settings, 'AE'));
    assert.ok(hasSetShippingPrice(settings, 'EG'));
    assert.ok(hasSetShippingPrice({ deliveryCountries: [] }, 'EG'));
    assert.ok(!hasSetShippingPrice({ deliveryCountries: [] }, 'US'));
  });

  it('a saved list is cleaned: no Egypt, no unknown codes, no repeats, sorted', () => {
    assert.deepEqual(parseDeliveryCountries(['us', 'EG', 'ZZ', 'AE', 'US', 4, ' fr ']), ['AE', 'FR', 'US']);
    assert.deepEqual(parseDeliveryCountries([]), []);
    assert.equal(parseDeliveryCountries(undefined), null);
    assert.equal(parseDeliveryCountries('US'), null);
  });
});
