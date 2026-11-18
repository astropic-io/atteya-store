import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Runs against the compiled code (`npm test` builds first).
import {
  countryExtraFee,
  DEFAULT_DELIVERY_COUNTRIES,
  DELIVERY_COUNTRY_CODES,
  hasSetShippingPrice,
  isDeliveryCountry,
  parseDeliveryCountries,
  parseDeliveryCountryFees,
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

describe('extra delivery fee per country (ATS-326)', () => {
  it('keeps known countries abroad with whole fees from 0 to 50,000', () => {
    assert.deepEqual(
      parseDeliveryCountryFees({ ae: 200.4, US: 0, EG: 50, ZZ: 10, FR: -1, DE: 50_001, GB: 'x', IT: 99.6 }),
      { AE: 200, US: 0, IT: 100 },
    );
    assert.deepEqual(parseDeliveryCountryFees(null), {});
    assert.deepEqual(parseDeliveryCountryFees(['AE']), {});
  });

  it('only a listed country abroad pays its extra', () => {
    const settings = { deliveryCountries: ['AE', 'US'], deliveryCountryFees: { AE: 300, BR: 500, EG: 40 } };
    assert.equal(countryExtraFee(settings, 'AE'), 300);
    assert.equal(countryExtraFee(settings, 'US'), 0);
    // Not on the list: the whole fee is agreed on WhatsApp, so no extra.
    assert.equal(countryExtraFee(settings, 'BR'), 0);
    // Egypt is priced by governorate.
    assert.equal(countryExtraFee(settings, 'EG'), 0);
    // Nothing saved: the default list, no extras.
    assert.equal(countryExtraFee({}, 'AE'), 0);
  });
});
