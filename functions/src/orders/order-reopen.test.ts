import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Runs against the compiled code (`npm test` builds first).
import { canManageStore, roleFromClaim } from '../../lib/auth/require-role.js';
import { claimId, orderEmailsForWrite } from '../../lib/email/order-email-events.js';
import { readOrderForEmail } from '../../lib/email/order-email-model.js';
import { renderOrderEmail, type OrderEmailContext } from '../../lib/email/order-email-templates.js';
import { OFFER_LIMIT_ACTOR } from '../../lib/orders/offer-usage.js';
import { REOPEN_HISTORY_REASON, reopenOrder } from '../../lib/orders/order-reopen.js';
import { REOPEN_TOO_LATE_MESSAGE, canReopenOrder, statusBeforeCancel } from '../../lib/store/order-status.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 14, 12);
const ACTOR = { uid: 'staff-1', email: 'staff@example.com', role: 'staff' };

/** In-memory stand-in for the Firestore calls `reopenOrder` makes (one transaction). */
function fakeDb(docs: Record<string, Record<string, unknown>>) {
  const store = new Map(Object.entries(docs).map(([path, data]) => [path, { ...data }]));
  const writes: { op: 'set' | 'update'; path: string; data: Record<string, unknown> }[] = [];
  const ref = (path: string) => ({ path, id: path.split('/').pop() });
  const snap = (path: string) => ({ exists: store.has(path), data: () => store.get(path) });
  const tx = {
    get: async (r: { path: string }) => snap(r.path),
    set: (r: { path: string }, data: Record<string, unknown>) => {
      writes.push({ op: 'set', path: r.path, data });
      store.set(r.path, { ...(store.get(r.path) ?? {}), ...data });
    },
    update: (r: { path: string }, data: Record<string, unknown>) => {
      if (!store.has(r.path)) throw new Error(`no doc ${r.path}`);
      writes.push({ op: 'update', path: r.path, data });
      store.set(r.path, { ...store.get(r.path), ...data });
    },
  };
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, store, writes };
}

function at(ms: number) {
  return { toMillis: () => ms };
}

function cancelledOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'cancelled',
    paymentMethod: 'cash-on-delivery',
    cancelledAt: at(NOW - 2 * DAY),
    cancelledBy: 'staff-2',
    confirmedAt: at(NOW - 3 * DAY),
    stockDecrementedAt: null,
    stockReturnedAt: at(NOW - 2 * DAY),
    pricing: {
      lines: [
        {
          productId: 'p1',
          quantity: 2,
          selection: { size: 'm' },
          name: 'Linen Shirt',
          optionLabels: [{ label: 'Size', value: 'M' }],
        },
      ],
    },
    ...overrides,
  };
}

function notes(from: string) {
  return {
    statusHistory: [
      { status: 'confirmed', from: 'pending' },
      { status: 'cancelled', from, reason: 'Mistake' },
    ],
    cancelReason: 'Mistake',
  };
}

const PRODUCT = {
  name: 'Linen Shirt',
  stock: 5,
  stockBySize: { m: 5 },
  options: [{ key: 'size', values: [{ id: 'm', label: 'M' }] }],
};

describe('reopen rules', () => {
  it('allows cancelled manual orders within 7 days only', () => {
    const base = { status: 'cancelled', paymentMethod: 'instapay', cancelledAtMs: NOW - 6 * DAY };
    assert.equal(canReopenOrder(base, NOW), true);
    assert.equal(canReopenOrder({ ...base, cancelledAtMs: NOW - 8 * DAY }, NOW), false);
    assert.equal(canReopenOrder({ ...base, cancelledAtMs: null }, NOW), false);
    assert.equal(canReopenOrder({ ...base, status: 'failed' }, NOW), false);
    assert.equal(canReopenOrder({ ...base, paymentMethod: 'paymob' }, NOW), false);
    assert.equal(canReopenOrder({ ...base, status: 'confirmed' }, NOW), false);
  });

  it('reads the status before the latest cancel', () => {
    assert.equal(statusBeforeCancel(notes('confirmed').statusHistory), 'confirmed');
    assert.equal(statusBeforeCancel(notes('pending').statusHistory), 'pending');
    assert.equal(
      statusBeforeCancel([
        { status: 'cancelled', from: 'pending' },
        { status: 'pending', from: 'cancelled' },
        { status: 'confirmed', from: 'pending' },
        { status: 'cancelled', from: 'confirmed' },
      ]),
      'confirmed',
    );
    assert.equal(statusBeforeCancel([{ status: 'confirmed', from: 'pending' }]), null);
  });

  it('lets only admins and staff run the callable', () => {
    assert.equal(canManageStore(roleFromClaim('staff')), true);
    assert.equal(canManageStore(roleFromClaim('admin')), true);
    assert.equal(canManageStore(roleFromClaim(undefined)), false);
    assert.equal(canManageStore(roleFromClaim('user')), false);
  });
});

describe('reopenOrder', () => {
  it('back to Confirmed takes stock once and adds the history row', async () => {
    const { db, store } = fakeDb({
      'orders/o1': cancelledOrder(),
      'orderStaffNotes/o1': notes('confirmed'),
      'products/p1': PRODUCT,
    });
    const result = await reopenOrder(db, 'o1', ACTOR, NOW);
    assert.deepEqual(result, { orderId: 'o1', status: 'confirmed', stock: 'take' });
    assert.deepEqual(store.get('products/p1')?.['stockBySize'], { m: 3 });
    const order = store.get('orders/o1')!;
    assert.equal(order['status'], 'confirmed');
    assert.equal(order['cancelledAt'], null);
    assert.equal(order['cancelledBy'], null);
    assert.equal(order['reopenedBy'], 'staff-1');
    assert.notEqual(order['stockDecrementedAt'], null);
    const notesDoc = store.get('orderStaffNotes/o1')!;
    assert.equal(notesDoc['cancelReason'], null);
    // arrayUnion sentinel: check the row it adds.
    const union = notesDoc['statusHistory'] as { elements?: unknown[]; _elements?: unknown[] };
    const rows = (union.elements ?? union._elements ?? []) as Record<string, unknown>[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!['status'], 'confirmed');
    assert.equal(rows[0]!['from'], 'cancelled');
    assert.equal(rows[0]!['reason'], REOPEN_HISTORY_REASON);
    assert.equal(rows[0]!['byEmail'], 'staff@example.com');

    // Already Confirmed now: a second reopen is refused and stock stays where it is.
    await assert.rejects(reopenOrder(db, 'o1', ACTOR, NOW), /Only cancelled orders/);
    assert.deepEqual(store.get('products/p1')?.['stockBySize'], { m: 3 });
  });

  it('refuses with the item named when stock is short, and changes nothing', async () => {
    const { db, writes } = fakeDb({
      'orders/o1': cancelledOrder(),
      'orderStaffNotes/o1': notes('confirmed'),
      'products/p1': { ...PRODUCT, stock: 1, stockBySize: { m: 1 } },
    });
    await assert.rejects(reopenOrder(db, 'o1', ACTOR, NOW), {
      message:
        "Can't reopen #O1: Linen Shirt (M) has only 1 left. Add stock first, or ask the shopper to order again.",
    });
    assert.equal(writes.length, 0);
  });

  it('back to Waiting for Payment takes no stock', async () => {
    const { db, store, writes } = fakeDb({
      'orders/o1': cancelledOrder({ confirmedAt: null, stockReturnedAt: null }),
      'orderStaffNotes/o1': notes('pending'),
      'products/p1': PRODUCT,
    });
    const result = await reopenOrder(db, 'o1', ACTOR, NOW);
    assert.equal(result.status, 'pending');
    assert.equal(result.stock, 'none');
    assert.equal(
      writes.some((w) => w.path.startsWith('products/')),
      false,
    );
    assert.equal(store.get('orders/o1')?.['status'], 'pending');
    assert.equal(store.get('orders/o1')?.['confirmedAt'], null);
  });

  const withOffer = {
    offerUses: { offerIds: ['deal-1'], customerKeys: ['uid-1'], switchedOffIds: ['deal-1'] },
    offerUsesReturnedAt: at(NOW - 2 * DAY),
  };

  it('counts the offer uses again and switches a now-full offer off', async () => {
    const { db, store } = fakeDb({
      'orders/o1': cancelledOrder(withOffer),
      'orderStaffNotes/o1': notes('confirmed'),
      'products/p1': PRODUCT,
      'offerUsage/deal-1': { count: 2 },
      'offerUsage/deal-1_uid-1': { count: 0 },
      'offers/deal-1': { active: true, updatedBy: 'admin-1', limits: { totalUses: 3 } },
    });
    await reopenOrder(db, 'o1', ACTOR, NOW);
    assert.equal(store.get('offerUsage/deal-1')?.['count'], 3);
    assert.equal(store.get('offerUsage/deal-1_uid-1')?.['count'], 1);
    assert.equal(store.get('offers/deal-1')?.['active'], false);
    assert.equal(store.get('offers/deal-1')?.['updatedBy'], OFFER_LIMIT_ACTOR);
    assert.equal(store.get('orders/o1')?.['offerUsesReturnedAt'], null);
  });

  it('counts the uses again even when the offer has ended, and leaves an offer with uses left on', async () => {
    const ended = fakeDb({
      'orders/o1': cancelledOrder(withOffer),
      'orderStaffNotes/o1': notes('confirmed'),
      'products/p1': PRODUCT,
      'offerUsage/deal-1': { count: 3 },
      'offers/deal-1': { active: false, updatedBy: 'admin-1', limits: { totalUses: 3 } },
    });
    await reopenOrder(ended.db, 'o1', ACTOR, NOW);
    assert.equal(ended.store.get('offerUsage/deal-1')?.['count'], 4);
    assert.equal(ended.store.get('offers/deal-1')?.['updatedBy'], 'admin-1');

    const open = fakeDb({
      'orders/o1': cancelledOrder(withOffer),
      'orderStaffNotes/o1': notes('confirmed'),
      'products/p1': PRODUCT,
      'offerUsage/deal-1': { count: 1 },
      'offers/deal-1': { active: true, updatedBy: OFFER_LIMIT_ACTOR, limits: { totalUses: 5 } },
    });
    await reopenOrder(open.db, 'o1', ACTOR, NOW);
    assert.equal(open.store.get('offerUsage/deal-1')?.['count'], 2);
    assert.equal(open.store.get('offers/deal-1')?.['active'], true);
    // No customer count doc was there to give back to: none is made up.
    assert.equal(open.store.has('offerUsage/deal-1_uid-1'), false);
  });

  it("refuses back to Confirmed when the cancel couldn't put every piece back", async () => {
    const { db, writes } = fakeDb({
      'orders/o1': cancelledOrder({ stockNotReturned: 2 }),
      'orderStaffNotes/o1': notes('confirmed'),
      'products/p1': PRODUCT,
    });
    await assert.rejects(reopenOrder(db, 'o1', ACTOR, NOW), /didn't go back into stock/);
    assert.equal(writes.length, 0);
  });

  it('refuses after 7 days, Payment Failed and Card orders', async () => {
    const cases: [Record<string, unknown>, RegExp | string][] = [
      [cancelledOrder({ cancelledAt: at(NOW - 8 * DAY) }), REOPEN_TOO_LATE_MESSAGE],
      [cancelledOrder({ status: 'failed' }), /Only cancelled orders/],
      [cancelledOrder({ paymentMethod: 'paymob' }), /Card orders can't be reopened/],
    ];
    for (const [order, message] of cases) {
      const { db, writes } = fakeDb({
        'orders/o1': order,
        'orderStaffNotes/o1': notes('confirmed'),
        'products/p1': PRODUCT,
      });
      await assert.rejects(
        reopenOrder(db, 'o1', ACTOR, NOW),
        typeof message === 'string' ? { message } : message,
      );
      assert.equal(writes.length, 0);
    }
  });

  it('refuses when the status before the cancel is unknown', async () => {
    const { db } = fakeDb({ 'orders/o1': cancelledOrder(), 'products/p1': PRODUCT });
    await assert.rejects(reopenOrder(db, 'o1', ACTOR, NOW), /can't be reopened/);
  });
});

describe('"back on" email', () => {
  const line = { productId: 'p1', quantity: 1, unitEgp: 500, selection: {}, name: 'Linen Shirt' };
  const doc = (status: string, paymentMethod: string, extra: Record<string, unknown> = {}) =>
    readOrderForEmail('abc123xyz', {
      status,
      paymentMethod,
      customerEmail: 'shopper@example.com',
      shipping: { fullName: 'Mona Ali', line1: 'St 1', city: 'Cairo', country: 'EG', phone: '01000000000' },
      pricing: {
        lines: [line],
        subtotalEgp: 500,
        shipping: { priceEgp: 0, kind: 'domestic' },
        totalEgp: 500,
      },
      ...extra,
    });

  it('is sent once per reopen, never for Card', () => {
    const before = doc('cancelled', 'cash-on-delivery');
    const after = doc('confirmed', 'cash-on-delivery', { reopenedAt: at(NOW) });
    assert.deepEqual(orderEmailsForWrite(before, after), ['order-reopened']);
    assert.deepEqual(orderEmailsForWrite(before, doc('pending', 'instapay')), ['order-reopened']);
    assert.deepEqual(orderEmailsForWrite(doc('cancelled', 'paymob'), doc('confirmed', 'paymob')), [
      'paid-confirmed',
      'store-new-order',
    ]);
    assert.equal(claimId('order-reopened', after!), `abc123xyz_order-reopened_${NOW}`);
  });

  it('says sorry and gives the status', () => {
    const ctx: OrderEmailContext = {
      storefrontUrl: 'https://shop.example',
      imageBaseUrl: '',
      canReply: false,
      storeName: 'Store',
      whatsappNumber: '',
      instapay: { address: '', number: '' },
      bankTransfer: { accountName: '', bankName: '', iban: '', swift: '' },
    };
    const confirmed = renderOrderEmail('order-reopened', doc('confirmed', 'instapay')!, ctx);
    assert.equal(confirmed.subject, 'Your order #ABC123 is back on');
    assert.match(
      confirmed.text,
      /Sorry for the mix-up, Mona\. Your order #ABC123 is back on\. It's confirmed/,
    );
    assert.match(confirmed.html, /View Your Order/);
    const pending = renderOrderEmail('order-reopened', doc('pending', 'cash-on-delivery')!, ctx);
    assert.equal(pending.subject, 'Your order #ABC123 is back on');
    assert.match(pending.text, /Back On/);
    // InstaPay pending: the cancel may have been the mistake on a paid order.
    const instapay = renderOrderEmail('order-reopened', doc('pending', 'instapay')!, ctx);
    assert.match(instapay.text, /If you already paid, there's nothing to do/);
  });
});
