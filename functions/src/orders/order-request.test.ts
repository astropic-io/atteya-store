import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Runs against the compiled code (`npm test` builds first).
import { parseCreateStoreOrderRequest } from '../../lib/orders/order-request.js';
import {
  ABROAD_PHONE_MESSAGE,
  DELIVERY_FIELD_MESSAGES,
  EGYPT_PHONE_MESSAGE,
} from '../../lib/store/order-messages.js';

const LINES = [{ productId: 'tee-black', variantId: null, quantity: 1 }];

function abroad(overrides: Record<string, unknown> = {}) {
  return {
    lines: LINES,
    paymentMethod: 'bank-transfer',
    shipping: {
      fullName: 'Mona Ali',
      line1: '12 Nathan Road',
      line2: null,
      city: 'Hong Kong',
      region: null,
      postalCode: '',
      country: 'HK',
      phone: '+852 9123 4567',
      ...overrides,
    },
  };
}

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

describe('order request: only what we need is required (ATS-318)', () => {
  it('accepts an order abroad with no postal code', () => {
    const request = parseCreateStoreOrderRequest(abroad());
    assert.equal(request.shipping.postalCode, '');
    assert.equal(request.shipping.country, 'HK');
  });

  it('accepts an order abroad with the postal code left out entirely', () => {
    const request = parseCreateStoreOrderRequest(abroad({ postalCode: undefined }));
    assert.equal(request.shipping.postalCode, '');
  });

  it('keeps a postal code when one is given', () => {
    const request = parseCreateStoreOrderRequest(
      abroad({ country: 'GB', postalCode: ' SW1A 1AA ', phone: '+44 7700 900123' }),
    );
    assert.equal(request.shipping.postalCode, 'SW1A 1AA');
  });

  it('refuses a postal code that is too long instead of dropping it', () => {
    assert.match(
      refusal(() => parseCreateStoreOrderRequest(abroad({ postalCode: 'X'.repeat(21) }))),
      /Postal codes are 20 characters or fewer/,
    );
  });

  it('refuses an order abroad without a city', () => {
    assert.equal(
      refusal(() => parseCreateStoreOrderRequest(abroad({ city: '  ' }))),
      DELIVERY_FIELD_MESSAGES.city,
    );
  });

  it('refuses an order abroad without a phone', () => {
    assert.equal(
      refusal(() => parseCreateStoreOrderRequest(abroad({ phone: '' }))),
      DELIVERY_FIELD_MESSAGES.phone,
    );
  });

  it('refuses an order abroad with a phone that has no country code', () => {
    assert.equal(
      refusal(() => parseCreateStoreOrderRequest(abroad({ phone: '12345' }))),
      ABROAD_PHONE_MESSAGE,
    );
  });

  it('refuses an order without a name or address', () => {
    assert.equal(
      refusal(() => parseCreateStoreOrderRequest(abroad({ fullName: '' }))),
      DELIVERY_FIELD_MESSAGES.fullName,
    );
    assert.equal(
      refusal(() => parseCreateStoreOrderRequest(abroad({ line1: '' }))),
      DELIVERY_FIELD_MESSAGES.line1,
    );
  });

  it('Egypt still needs a governorate and an Egyptian mobile', () => {
    const egypt = (shipping: Record<string, unknown>) =>
      parseCreateStoreOrderRequest({
        lines: LINES,
        paymentMethod: 'cash-on-delivery',
        shipping: {
          fullName: 'Mona Ali',
          line1: '5 Tahrir St',
          country: 'EG',
          phone: '010 1234 5678',
          ...shipping,
        },
      });
    assert.equal(
      refusal(() => egypt({})),
      'Choose your governorate.',
    );
    assert.equal(
      refusal(() => egypt({ city: 'Cairo', phone: '+44 7700 900123' })),
      EGYPT_PHONE_MESSAGE,
    );
    assert.equal(egypt({ city: 'Cairo', postalCode: '11511' }).shipping.postalCode, '');
  });
});
