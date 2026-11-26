import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ABROAD_PLACE,
  buildDayStats,
  cairoDayKey,
  cairoDayRangeMs,
  cairoDayStartMs,
  daysOf,
  isDayKey,
  isEmptyDay,
  nextDayKey,
  orderStatsChanged,
  returnStatsChanged,
  statsOrderFrom,
  statsReturnFrom,
  type StatsOrderInput,
} from '../../lib/stats/store-stats.js';

const HOUR = 60 * 60 * 1000;

describe('Cairo days', () => {
  it('puts an order placed late at night UTC on the next Cairo day in winter (UTC+2)', () => {
    assert.equal(cairoDayKey(Date.UTC(2026, 10, 25, 22, 30)), '2026-11-26');
    assert.equal(cairoDayKey(Date.UTC(2026, 10, 25, 21, 59)), '2026-11-25');
  });

  it('uses UTC+3 in summer', () => {
    assert.equal(cairoDayKey(Date.UTC(2026, 6, 10, 21, 0)), '2026-07-11');
    assert.equal(cairoDayKey(Date.UTC(2026, 6, 10, 20, 59)), '2026-07-10');
  });

  it('starts a winter day at 22:00 UTC the day before', () => {
    assert.equal(cairoDayStartMs('2026-11-26'), Date.UTC(2026, 10, 25, 22, 0));
  });

  it('starts a summer day at 21:00 UTC the day before', () => {
    assert.equal(cairoDayStartMs('2026-07-11'), Date.UTC(2026, 6, 10, 21, 0));
  });

  it('gives every day of the year a start inside that day and contiguous ranges', () => {
    let day = '2026-01-01';
    for (let i = 0; i < 365; i += 1) {
      const { startMs, endMs } = cairoDayRangeMs(day);
      assert.equal(cairoDayKey(startMs), day, day);
      assert.equal(cairoDayKey(startMs - 1), i === 0 ? '2025-12-31' : cairoDayKey(startMs - 1));
      assert.notEqual(cairoDayKey(startMs - 1), day, day);
      assert.ok(endMs - startMs >= 23 * HOUR && endMs - startMs <= 25 * HOUR, day);
      day = nextDayKey(day);
    }
  });

  it('checks day keys', () => {
    assert.equal(isDayKey('2026-02-28'), true);
    assert.equal(isDayKey('2026-02-30'), false);
    assert.equal(isDayKey('2026-2-3'), false);
    assert.equal(isDayKey(20260228), false);
  });

  it('lists distinct days', () => {
    const ms = Date.UTC(2026, 10, 25, 23);
    assert.deepEqual(daysOf(ms, ms + HOUR, null, ms - 3 * HOUR), ['2026-11-25', '2026-11-26']);
  });
});

const order = (patch: Partial<StatsOrderInput> = {}): StatsOrderInput => ({
  status: 'confirmed',
  paymentMethod: 'cash-on-delivery',
  receivedEgp: 500,
  place: 'Cairo',
  lines: [{ productId: 'p1', name: 'Grip socks', quantity: 2, paidEgp: 400, gift: false }],
  ...patch,
});

describe('buildDayStats', () => {
  it('counts orders, statuses, sold pieces and money', () => {
    const stats = buildDayStats(
      '2026-11-26',
      [
        order(),
        order({ status: 'delivered', paymentMethod: 'instapay', place: 'Giza', receivedEgp: 300 }),
        order({ status: 'pending', receivedEgp: 999 }),
        order({ status: 'cancelled', receivedEgp: 999 }),
        order({ status: 'failed', paymentMethod: 'paymob', receivedEgp: 999 }),
      ],
      [],
    );
    assert.equal(stats.counts.orders, 4);
    assert.equal(stats.counts.failedOrders, 1);
    assert.deepEqual(stats.counts.byStatus, {
      pending: 1,
      confirmed: 1,
      shipped: 0,
      delivered: 1,
      cancelled: 1,
    });
    assert.equal(stats.counts.soldOrders, 2);
    assert.equal(stats.counts.pieces, 4);
    assert.deepEqual(stats.counts.byPayment, { 'cash-on-delivery': 3, instapay: 1 });
    assert.deepEqual(stats.counts.byPlace, { Cairo: 3, Giza: 1 });
    assert.deepEqual(stats.counts.products, { p1: { name: 'Grip socks', pieces: 4 } });
    assert.equal(stats.money.receivedEgp, 800);
    assert.deepEqual(stats.money.productEgp, { p1: 800 });
  });

  it('leaves free gifts out of pieces and best sellers', () => {
    const stats = buildDayStats(
      '2026-11-26',
      [
        order({
          lines: [
            { productId: 'p1', name: 'Bag', quantity: 1, paidEgp: 900, gift: false },
            { productId: 'g1', name: 'Gift', quantity: 1, paidEgp: 0, gift: true },
          ],
        }),
      ],
      [],
    );
    assert.equal(stats.counts.pieces, 1);
    assert.deepEqual(Object.keys(stats.counts.products), ['p1']);
  });

  it('counts returns sent this day and refunds sent this day', () => {
    const stats = buildDayStats(
      '2026-11-26',
      [],
      [
        { status: 'requested', hasRefund: true, refundEgp: 300, sentThisDay: true, refundedThisDay: false },
        { status: 'approved', hasRefund: false, refundEgp: 0, sentThisDay: true, refundedThisDay: false },
        { status: 'cancelled', hasRefund: true, refundEgp: 200, sentThisDay: true, refundedThisDay: false },
        { status: 'refund-sent', hasRefund: true, refundEgp: 450, sentThisDay: false, refundedThisDay: true },
      ],
    );
    assert.equal(stats.counts.returns, 2);
    assert.equal(stats.counts.refundRequests, 1);
    assert.equal(stats.counts.refundsSent, 1);
    assert.equal(stats.money.refundsEgp, 450);
    assert.equal(isEmptyDay(stats), false);
  });

  it('marks a day with nothing as empty', () => {
    assert.equal(isEmptyDay(buildDayStats('2026-11-26', [], [])), true);
  });

  it('cleans map keys Firestore would refuse', () => {
    const stats = buildDayStats('2026-11-26', [order({ place: 'Port.Said', paymentMethod: '' })], []);
    assert.deepEqual(stats.counts.byPlace, { 'Port Said': 1 });
    assert.deepEqual(stats.counts.byPayment, { unknown: 1 });
  });
});

describe('statsOrderFrom', () => {
  it('reads an Egypt order with its governorate and lines', () => {
    const input = statsOrderFrom({
      status: 'shipped',
      paymentMethod: 'instapay',
      pricing: {
        totalEgp: 1250,
        lines: [
          { productId: 'p1', name: 'Tee', quantity: 1, lineDisplay: 650 },
          { productId: 'p2', name: 'Socks', quantity: 3, unitEgp: 200 },
          { productId: 'g', name: 'Gift', quantity: 1, gift: { forLine: 0 } },
        ],
      },
      shipping: { city: 'Alexandria', country: 'EG' },
    });
    assert.equal(input.receivedEgp, 1250);
    assert.equal(input.place, 'Alexandria');
    assert.deepEqual(
      input.lines.map((line) => [line.productId, line.quantity, line.paidEgp, line.gift]),
      [
        ['p1', 1, 650, false],
        ['p2', 3, 600, false],
        ['g', 1, 0, true],
      ],
    );
  });

  it('puts an order abroad under abroad and uses the pounds Card charged', () => {
    const input = statsOrderFrom({
      status: 'confirmed',
      paymentMethod: 'paymob',
      pricing: { totalEgp: 3000, chargeEgp: 3400, lines: [] },
      shipping: { city: 'Dubai', country: 'ae' },
    });
    assert.equal(input.place, ABROAD_PLACE);
    assert.equal(input.receivedEgp, 3400);
  });
});

describe('statsReturnFrom', () => {
  const start = Date.UTC(2026, 10, 25, 22);
  const end = start + 24 * HOUR;
  it('marks a refund sent within the day', () => {
    const input = statsReturnFrom(
      { status: 'refund-sent', hasRefund: true, refundEgp: 450.4 },
      start - 3 * 24 * HOUR,
      start + HOUR,
      start,
      end,
    );
    assert.deepEqual(input, {
      status: 'refund-sent',
      hasRefund: true,
      refundEgp: 450,
      sentThisDay: false,
      refundedThisDay: true,
    });
  });
});

describe('what changes rebuild a day', () => {
  it('ignores order writes that leave the counted fields alone', () => {
    const base = { status: 'confirmed', pricing: { totalEgp: 10 }, emailSent: false };
    assert.equal(orderStatsChanged(base, { ...base, emailSent: true }), false);
    assert.equal(orderStatsChanged(base, { ...base, status: 'shipped' }), true);
    assert.equal(orderStatsChanged(base, undefined), true);
  });

  it('compares timestamps by value', () => {
    const ts = (ms: number) => ({ ms, isEqual: (other: { ms: number }) => other.ms === ms });
    assert.equal(returnStatsChanged({ createdAt: ts(1) }, { createdAt: ts(1) }), false);
    assert.equal(returnStatsChanged({ createdAt: ts(1) }, { createdAt: ts(2) }), true);
  });
});
