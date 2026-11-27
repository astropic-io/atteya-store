import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isStaffExtra, readExtras, removesExtra, roleHasExtra } from '../../lib/auth/staff-extras.js';

describe('readExtras', () => {
  it('keeps known extras once each, in a fixed order', () => {
    assert.deepEqual(readExtras(['money', 'refunds', 'money']), ['refunds', 'money']);
  });

  it('drops anything unknown or not a list', () => {
    assert.deepEqual(readExtras(['refunds', 'teamAdmin', 3, null]), ['refunds']);
    assert.deepEqual(readExtras('refunds'), []);
    assert.deepEqual(readExtras(undefined), []);
  });

  it('isStaffExtra only accepts the three names', () => {
    assert.equal(isStaffExtra('deleteOrders'), true);
    assert.equal(isStaffExtra('admin'), false);
  });
});

describe('roleHasExtra', () => {
  it('admins have every extra', () => {
    assert.equal(roleHasExtra('admin', [], 'deleteOrders'), true);
  });

  it('staff only have the extras switched on for them', () => {
    assert.equal(roleHasExtra('staff', ['refunds'], 'refunds'), true);
    assert.equal(roleHasExtra('staff', ['refunds'], 'deleteOrders'), false);
  });

  it('a normal account never has an extra, even with a leftover claim', () => {
    assert.equal(roleHasExtra('user', ['refunds', 'deleteOrders', 'money'], 'refunds'), false);
  });
});

describe('removesExtra', () => {
  it('is true only when something that was on is switched off', () => {
    assert.equal(removesExtra(['refunds'], ['refunds', 'money']), false);
    assert.equal(removesExtra(['refunds', 'money'], ['money']), true);
    assert.equal(removesExtra([], []), false);
  });
});
