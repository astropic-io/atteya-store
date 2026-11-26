import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Runs against the compiled code (`npm test` builds first).
import {
  ITEM_CANCEL_LAST_PIECES_MESSAGE,
  itemCancelRefusal,
  itemRefundsToSendEgp,
  parseItemCancelRequest,
  planItemCancel,
  readItemCancels,
} from '../../lib/store/order-item-cancel.js';
import { cancelOrderItem, markItemRefundSent } from '../../lib/orders/order-item-cancel.js';
import { claimId, orderEmailsForWrite } from '../../lib/email/order-email-events.js';
import { readOrderForEmail } from '../../lib/email/order-email-model.js';
import { renderOrderEmail } from '../../lib/email/order-email-templates.js';

const socks = {
  productId: 'socks',
  variantId: null,
  selection: { size: 's40' },
  quantity: 3,
  unitEgp: 100,
  unitDisplay: 100,
  lineDisplay: 225,
  fullEgp: 300,
  discountEgp: 75,
  deals: [{ offerId: 'bundle', units: 3, percent: 0, discountEgp: 75, bundle: true }],
  name: 'Club Socks',
  optionLabels: [{ label: 'Size', value: '40–44' }],
  imagePath: 'products/socks.jpg',
};
const shirt = {
  productId: 'shirt',
  variantId: null,
  selection: { size: 'm' },
  quantity: 1,
  unitEgp: 850,
  unitDisplay: 850,
  lineDisplay: 850,
  name: 'Linen Shirt',
  optionLabels: [{ label: 'Size', value: 'M' }],
  imagePath: null,
};
const gift = {
  productId: 'bag',
  variantId: null,
  selection: {},
  quantity: 1,
  unitEgp: 0,
  unitDisplay: 0,
  lineDisplay: 0,
  name: 'Tote Bag',
  optionLabels: [],
  imagePath: null,
  gift: { offerId: 'g', giftId: 'g1', giftName: 'Tote Bag', forLine: 1 },
};

function order(over: Record<string, unknown> = {}) {
  return {
    status: 'confirmed',
    paymentMethod: 'instapay',
    shipping: { country: 'EG' },
    pricing: {
      isInternational: false,
      lines: [socks, shirt, gift],
      subtotalEgp: 1075,
      subtotalDisplay: 1075,
      shipping: { kind: 'domestic-box', boxId: 'b', priceEgp: 60, priceDisplay: 60 },
      totalEgp: 1135,
      totalDisplay: 1135,
    },
    ...over,
  };
}

describe('itemCancelRefusal', () => {
  it('allows Waiting for Payment and Confirmed Cash on Delivery or InstaPay orders in Egypt', () => {
    assert.equal(itemCancelRefusal(order()), null);
    assert.equal(itemCancelRefusal(order({ status: 'pending', paymentMethod: 'cash-on-delivery' })), null);
  });
  it('refuses Card, abroad, shipped, delivered and cancelled orders', () => {
    assert.match(itemCancelRefusal(order({ paymentMethod: 'paymob' }))!, /Card/);
    assert.match(itemCancelRefusal(order({ shipping: { country: 'QA' } }))!, /abroad/);
    assert.match(itemCancelRefusal(order({ status: 'shipped' }))!, /courier/);
    assert.match(itemCancelRefusal(order({ status: 'delivered' }))!, /Start Return for Customer/);
    assert.match(itemCancelRefusal(order({ status: 'cancelled' }))!, /cancelled/);
  });
});

describe('planItemCancel', () => {
  it('defaults the amount off to what was paid for the pieces and keeps shipping', () => {
    const r = planItemCancel(order(), { lineIndex: 0, quantity: 1, amountOffEgp: null });
    assert.ok(r.ok);
    assert.equal(r.plan.amountOffEgp, 75);
    assert.equal(r.plan.totalEgp, 1060);
    assert.equal(r.plan.subtotalEgp, 1000);
    assert.equal(r.plan.shippingEgp, 60);
    assert.equal(r.plan.refundOwed, true);
    assert.equal(r.plan.inGroupDeal, true);
    const line = r.plan.lines[0]!;
    assert.equal(line.quantity, 2);
    assert.equal(line.lineDisplay, 150);
    assert.equal(line.fullEgp, 200);
    assert.equal(line.discountEgp, 50);
    assert.equal(line.deals![0]!.units, 2);
  });

  it('lets staff lower the amount off down to the normal price of the pieces left', () => {
    const r = planItemCancel(order(), { lineIndex: 0, quantity: 1, amountOffEgp: 50 });
    assert.ok(r.ok);
    assert.equal(r.plan.minAmountOffEgp, 25);
    assert.equal(r.plan.lines[0]!.lineDisplay, 175);
    assert.equal(r.plan.totalEgp, 1085);
    const low = planItemCancel(order(), { lineIndex: 0, quantity: 1, amountOffEgp: 10 });
    assert.equal(low.ok, false);
    const high = planItemCancel(order(), { lineIndex: 0, quantity: 1, amountOffEgp: 80 });
    assert.equal(high.ok, false);
  });

  it('removes an emptied line with its gift and renumbers later gifts', () => {
    const r = planItemCancel(order(), { lineIndex: 1, quantity: 1, amountOffEgp: null });
    assert.ok(r.ok);
    assert.equal(r.plan.lines.length, 1);
    assert.deepEqual(r.plan.gifts, [{ lineIndex: 2, quantity: 1 }]);
    assert.equal(r.plan.totalEgp, 285);

    const giftAfter = { ...gift, gift: { ...gift.gift, forLine: 1 } };
    const o = order({ pricing: { ...order().pricing, lines: [shirt, socks, giftAfter] } });
    const r2 = planItemCancel(o, { lineIndex: 0, quantity: 1, amountOffEgp: null });
    assert.ok(r2.ok);
    assert.equal(r2.plan.lines.length, 2);
    assert.equal((r2.plan.lines[1]!.gift as { forLine: number }).forLine, 0);
  });

  it('refuses cancelling every piece left, a gift alone, and too many pieces', () => {
    const one = order({ pricing: { ...order().pricing, lines: [shirt] } });
    const r = planItemCancel(one, { lineIndex: 0, quantity: 1, amountOffEgp: null });
    assert.deepEqual(r, { ok: false, message: ITEM_CANCEL_LAST_PIECES_MESSAGE });
    assert.equal(planItemCancel(order(), { lineIndex: 2, quantity: 1, amountOffEgp: null }).ok, false);
    assert.equal(planItemCancel(order(), { lineIndex: 0, quantity: 4, amountOffEgp: null }).ok, false);
  });

  it('owes no refund before payment or on Cash on Delivery', () => {
    for (const over of [{ status: 'pending' }, { paymentMethod: 'cash-on-delivery' }]) {
      const r = planItemCancel(order(over), { lineIndex: 0, quantity: 1, amountOffEgp: null });
      assert.ok(r.ok);
      assert.equal(r.plan.refundOwed, false);
    }
  });
});

describe('parseItemCancelRequest', () => {
  it('reads a request and refuses bad input', () => {
    assert.deepEqual(
      parseItemCancelRequest({ orderId: 'o1', lineIndex: 0, quantity: 1, refundTo: ' 0100 ', reason: '' }),
      {
        orderId: 'o1',
        lineIndex: 0,
        quantity: 1,
        amountOffEgp: null,
        refundTo: '0100',
        reason: null,
        emailCustomer: true,
      },
    );
    assert.equal(parseItemCancelRequest({ orderId: 'a/b', lineIndex: 0, quantity: 1 }), null);
    assert.equal(parseItemCancelRequest({ orderId: 'o', lineIndex: 0, quantity: 0 }), null);
    assert.equal(
      parseItemCancelRequest({ orderId: 'o', lineIndex: 0, quantity: 1, amountOffEgp: 1.5 }),
      null,
    );
    assert.equal(
      parseItemCancelRequest({ orderId: 'o', lineIndex: 0, quantity: 1, reason: 'x'.repeat(301) }),
      null,
    );
  });
});

/** In-memory stand-in for the Firestore calls the transaction makes. */
function fakeDb(docs: Record<string, Record<string, unknown>>) {
  const store = new Map(Object.entries(docs).map(([path, data]) => [path, structuredClone(data)]));
  const writes: { op: string; path: string; data: Record<string, unknown> }[] = [];
  const ref = (path: string) => ({ path, id: path.split('/').pop()! });
  const tx = {
    get: async (r: { path: string }) => ({ exists: store.has(r.path), data: () => store.get(r.path) }),
    set: (r: { path: string }, data: Record<string, unknown>) =>
      writes.push({ op: 'set', path: r.path, data }),
    update: (r: { path: string }, data: Record<string, unknown>) =>
      writes.push({ op: 'update', path: r.path, data }),
  };
  let n = 0;
  const db = {
    collection: (name: string) => ({
      doc: (id?: string) => ref(`${name}/${id ?? `auto${++n}abcdefghij`}`),
    }),
    runTransaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  return { db: db as never, writes };
}

const ACTOR = { uid: 'staff-1', email: 'staff@example.com', emailVerified: true, role: 'staff' as const };

describe('cancelOrderItem', () => {
  it('saves the new lines and totals, puts stock back and records the cancel', async () => {
    const { db, writes } = fakeDb({
      'orders/o1': { ...order(), stockDecrementedAt: 1 },
      'products/socks': { stockBySize: { s40: 4 }, options: [{ id: 'size', values: [{ id: 's40' }] }] },
    });
    const res = await cancelOrderItem(
      db,
      {
        orderId: 'o1',
        lineIndex: 0,
        quantity: 1,
        amountOffEgp: null,
        refundTo: '01001234567',
        reason: 'Called',
        emailCustomer: true,
      },
      ACTOR as never,
    );
    assert.equal(res.refundEgp, 75);
    assert.equal(res.totalEgp, 1060);
    const product = writes.find((w) => w.path === 'products/socks')!;
    assert.deepEqual((product.data['stockBySize'] as Record<string, number>)['s40'], 5);
    const orderWrite = writes.find((w) => w.path === 'orders/o1')!;
    assert.equal(orderWrite.data['pricing.totalEgp'], 1060);
    assert.ok(writes.some((w) => w.path.startsWith('auditLogs/')));
    assert.ok(writes.some((w) => w.path === 'orderStaffNotes/o1'));
  });

  it('needs the InstaPay details when a refund is owed', async () => {
    const { db } = fakeDb({ 'orders/o1': order() });
    await assert.rejects(
      cancelOrderItem(
        db,
        {
          orderId: 'o1',
          lineIndex: 0,
          quantity: 1,
          amountOffEgp: null,
          refundTo: null,
          reason: null,
          emailCustomer: true,
        },
        ACTOR as never,
      ),
      /InstaPay/,
    );
  });
});

describe('itemCancels list', () => {
  const entry = {
    id: 'c1',
    item: {
      productId: 'socks',
      selection: {},
      name: 'Club Socks',
      optionLabels: [],
      imagePath: null,
      quantity: 1,
    },
    gifts: [],
    amountOffEgp: 75,
    refundEgp: 75,
    refundTo: '0100',
    at: { seconds: 10 },
    refundSentAt: null,
  };
  it('reads entries and counts the refund still to send', () => {
    assert.equal(readItemCancels([entry, { bad: true }]).length, 1);
    assert.equal(itemRefundsToSendEgp([entry]), 75);
    assert.equal(itemRefundsToSendEgp([{ ...entry, refundSentAt: { seconds: 20 } }]), 0);
  });
  it('marks a refund sent once', async () => {
    const { db, writes } = fakeDb({ 'orders/o1': { itemCancels: [entry] } });
    const res = await markItemRefundSent(
      db,
      { orderId: 'o1', cancelId: 'c1', reference: null },
      ACTOR as never,
    );
    assert.equal(res.changed, true);
    const list = writes.find((w) => w.path === 'orders/o1')!.data['itemCancels'] as Record<string, unknown>[];
    assert.equal(list[0]!['refundSentEgp'], 75);
  });
});

describe('Item Cancelled email', () => {
  const after = (emailCustomer: boolean) => ({
    ...order({ customerEmail: 'a@example.com' }),
    itemCancels: [
      {
        id: 'c9',
        item: {
          productId: 'socks',
          selection: {},
          name: 'Club Socks',
          optionLabels: [{ label: 'Size', value: '40–44' }],
          imagePath: null,
          quantity: 1,
        },
        gifts: [],
        amountOffEgp: 75,
        refundEgp: 75,
        refundTo: '0100 123 4567',
        totalBeforeEgp: 1135,
        totalAfterEgp: 1060,
        emailCustomer,
        at: Date.UTC(2026, 10, 26),
      },
    ],
  });
  const ctx = {
    storefrontUrl: 'https://example.com',
    imageBaseUrl: '',
    canReply: true,
    storeName: 'ATTEYA STORE',
    whatsappNumber: '+20 100 000 0000',
    instapay: { address: '', number: '' },
    bankTransfer: { iban: '' },
  };

  it('goes once per cancel, only when staff left the email on', () => {
    const before = readOrderForEmail('o1', order({ customerEmail: 'a@example.com' }));
    const on = readOrderForEmail('o1', after(true))!;
    assert.deepEqual(orderEmailsForWrite(before, on), ['order-item-cancelled']);
    assert.equal(claimId('order-item-cancelled', on), 'o1_order-item-cancelled_c9');
    assert.deepEqual(orderEmailsForWrite(on, on), []);
    assert.deepEqual(orderEmailsForWrite(before, readOrderForEmail('o1', after(false))), []);
  });

  it('shows the refund, the whole InstaPay number and every item by state', () => {
    const email = renderOrderEmail(
      'order-item-cancelled',
      readOrderForEmail('o1', after(true))!,
      ctx as never,
    );
    assert.match(email.subject, /We cancelled 1 item from your order #O1/);
    assert.match(email.text, /Your refund: EGP\s?75/);
    assert.match(email.text, /InstaPay to 0100 123 4567/);
    assert.match(email.text, /Still coming · 4/);
    assert.match(email.text, /✕ Cancelled · 1/);
    assert.match(email.html, /0100 123 4567/);
  });
});
