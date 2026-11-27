import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isTypeId, knownTypeIds, readableTypeId } from '../../lib/products/product-types.js';

describe('product types (ATS-388)', () => {
  it('accepts lower-case ids joined by single hyphens', () => {
    assert.equal(isTypeId('hoodies'), true);
    assert.equal(isTypeId('t-shirts'), true);
    assert.equal(isTypeId('caps-2'), true);
  });

  it('refuses anything else', () => {
    for (const bad of ['', 'Hoodies', '-caps', 'caps-', 'caps--hats', 'caps hats', 'a'.repeat(41), 7, null]) {
      assert.equal(isTypeId(bad), false, String(bad));
    }
  });

  it('uses the built-in types when nothing is saved', () => {
    const ids = knownTypeIds(undefined);
    assert.equal(ids.has('socks'), true);
    assert.equal(ids.has('hoodies'), false);
    assert.equal(knownTypeIds({ types: [] }).has('rackets'), true);
  });

  it('uses the saved list, skipping bad rows', () => {
    const ids = knownTypeIds({
      types: [{ id: 'hoodies', label: 'Hoodies' }, { id: 'Bad Id' }, null, { id: 'socks' }],
    });
    assert.deepEqual([...ids].sort(), ['hoodies', 'socks']);
    assert.equal(ids.has('rackets'), false);
  });

  it('turns an id into a search label', () => {
    assert.equal(readableTypeId('padel-caps'), 'Padel caps');
  });
});
