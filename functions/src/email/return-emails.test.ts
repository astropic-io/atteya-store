import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { returnClaimId, returnEmailsForWrite } from '../../lib/email/return-email-events.js';
import { readReturnForEmail } from '../../lib/email/return-email-model.js';
import { renderReturnEmail } from '../../lib/email/return-email-templates.js';

/** Shopper emails for each staff step of a return or exchange request (ATS-294). */

const ctx = {
  storefrontUrl: 'https://atteyastore.com',
  imageBaseUrl: 'https://ik.imagekit.io/atteyastore',
  canReply: true,
  storeName: 'Atteya Store',
  whatsappNumber: '+20 100 000 0000',
  instapay: { address: '', number: '' },
  bankTransfer: { accountName: '', bankName: '', iban: '', swift: '' },
} as never;

const EXCHANGE = {
  lineIndex: 0,
  quantity: 1,
  kind: 'different-size',
  refund: false,
  name: 'Padel Shorts',
  optionLabels: [{ label: 'Size', value: 'M' }],
  askedLabel: 'Size M → L',
};
const RETURNED = {
  lineIndex: 1,
  quantity: 1,
  kind: 'return',
  refund: true,
  name: 'Training Tee',
  askedLabel: "Return · Didn't fit",
  refundEgp: 650,
};
const GIFT = {
  lineIndex: 2,
  quantity: 1,
  kind: 'return',
  refund: false,
  autoGift: true,
  forLine: 1,
  name: 'Sport Socks',
  askedLabel: 'Free gift',
};

const base = {
  ref: '#R-K7Q2M9',
  orderId: 'a1b2c3xyz',
  orderRef: '#A1B2C3',
  status: 'approved',
  customer: {
    name: 'Mariam Hassan',
    phone: '01012345678',
    email: 'mariam@example.com',
    guest: true,
    country: 'EG',
    line1: '12 Abbas El Akkad',
    city: 'Nasr City',
  },
  items: [EXCHANGE, RETURNED, GIFT],
  refundTo: '010 1234 5678',
  hasRefund: true,
  storeFault: false,
  itemsEgp: 650,
  feeEgp: 70,
  feePaid: 'off-refund',
  refundEgp: 580,
  cashAtDoorEgp: 0,
};

const exchangeOnly = {
  ...base,
  items: [EXCHANGE],
  hasRefund: false,
  itemsEgp: 0,
  feeEgp: 70,
  feePaid: 'cash',
  refundEgp: 0,
  cashAtDoorEgp: 70,
};

function request(overrides: Record<string, unknown> = {}, viewKey: string | null = null) {
  return readReturnForEmail('k7q2m9abc', { ...base, ...overrides }, viewKey)!;
}

function at(status: string, overrides: Record<string, unknown> = {}) {
  return request({ status, ...overrides });
}

describe('which return email each status change sends', () => {
  it('each staff step forward sends its one shopper email', () => {
    assert.deepEqual(returnEmailsForWrite(at('requested'), at('approved')), ['return-approved']);
    assert.deepEqual(returnEmailsForWrite(at('requested'), at('rejected')), ['return-rejected']);
    assert.deepEqual(returnEmailsForWrite(at('approved'), at('rejected')), ['return-rejected']);
    assert.deepEqual(returnEmailsForWrite(at('approved'), at('received')), ['return-received']);
    assert.deepEqual(returnEmailsForWrite(at('received'), at('refund-sent')), ['return-refund-sent']);
  });

  it('Cancelled sends nothing', () => {
    assert.deepEqual(returnEmailsForWrite(at('requested'), at('cancelled')), []);
  });

  it('a second write with the same status sends nothing', () => {
    for (const status of ['requested', 'approved', 'rejected', 'received', 'refund-sent']) {
      assert.deepEqual(returnEmailsForWrite(at(status), at(status, { note: 'edited' })), [], status);
    }
  });

  it('a step back or a skipped step sends nothing', () => {
    assert.deepEqual(returnEmailsForWrite(at('received'), at('approved')), []);
    assert.deepEqual(returnEmailsForWrite(at('refund-sent'), at('received')), []);
    assert.deepEqual(returnEmailsForWrite(at('approved'), at('requested')), []);
    assert.deepEqual(returnEmailsForWrite(at('requested'), at('received')), []);
    assert.deepEqual(returnEmailsForWrite(at('received'), at('rejected')), []);
    assert.deepEqual(returnEmailsForWrite(at('cancelled'), at('approved')), []);
  });

  it('a request written straight into a later status, or deleted, sends nothing', () => {
    assert.deepEqual(returnEmailsForWrite(null, at('approved')), []);
    assert.deepEqual(returnEmailsForWrite(at('approved'), null), []);
  });

  it('a Refund Sent of EGP 0 sends nothing', () => {
    assert.deepEqual(returnEmailsForWrite(at('received'), at('refund-sent', { refundSentEgp: 0 })), []);
  });

  it('each email has its own claim, so it is sent once', () => {
    assert.equal(returnClaimId('return-approved', at('approved')), 'k7q2m9abc_return-approved');
    assert.equal(returnClaimId('return-refund-sent', at('refund-sent')), 'k7q2m9abc_return-refund-sent');
  });
});

describe('return status emails', () => {
  it('Approved: courier, hand over with the gift, what they get, fee off the refund', () => {
    const email = renderReturnEmail('return-approved', request({}, 'v'.repeat(43)), ctx);
    assert.match(email.subject, /#R-K7Q2M9 is approved/);
    assert.match(email.html, /RETURN OR EXCHANGE · #R-K7Q2M9/);
    assert.match(email.html, /REQUEST<br>APPROVED/);
    assert.match(email.html, /Our courier will come to your delivery address\./);
    assert.match(email.text, /Hand Over: Padel Shorts · M, Training Tee, Sport Socks/);
    assert.match(email.text, /You Get: Padel Shorts in L, and EGP\s?580 by InstaPay once they're back/);
    assert.match(email.text, /Courier fee EGP\s?70, taken off your refund\./);
    assert.match(email.html, /View Your Order/);
    assert.match(email.html, /\?key=v{43}/);
  });

  it('Approved: cash at the door for an exchange, free for a damaged item', () => {
    const cash = renderReturnEmail('return-approved', request(exchangeOnly), ctx);
    assert.match(cash.text, /Courier fee EGP\s?70, cash at your door\./);
    const damaged = renderReturnEmail(
      'return-approved',
      request({
        items: [
          { ...EXCHANGE, kind: 'damaged', wants: 'send-another', askedLabel: 'Damaged · Send Another' },
        ],
        hasRefund: false,
        storeFault: true,
        feeEgp: 0,
        feePaid: 'free',
        refundEgp: 0,
      }),
      ctx,
    );
    assert.match(damaged.text, /You Get: A new Padel Shorts/);
    assert.match(damaged.text, /The courier visit is free\./);
  });

  it("Rejected: staff's reason and Message Us on WhatsApp", () => {
    const email = renderReturnEmail(
      'return-rejected',
      request({ status: 'rejected', rejectReason: 'The tee has been worn and washed.' }),
      ctx,
    );
    assert.match(email.html, /WE CAN&#39;T<br>TAKE IT BACK|WE CAN'T<br>TAKE IT BACK/);
    assert.match(email.html, /The tee has been worn and washed\./);
    assert.match(email.html, /Message Us on WhatsApp/);
    assert.match(email.html, /wa\.me\/201000000000/);
    assert.equal(email.html.split('Message Us on WhatsApp').length - 1, 1);
    assert.match(email.text, /Our Reason: "The tee has been worn and washed\."/);
  });

  it('Received: exchange-only says the exchange is done; a refund says it is on its way', () => {
    const exchange = renderReturnEmail(
      'return-received',
      request({ ...exchangeOnly, status: 'received' }),
      ctx,
    );
    assert.match(exchange.text, /Your exchange is done\./);
    assert.doesNotMatch(exchange.text, /refund/i);
    const refund = renderReturnEmail(
      'return-received',
      request({ status: 'received', refundEgp: 850, items: [RETURNED, GIFT] }),
      ctx,
    );
    assert.match(refund.text, /We got your items\. Your refund of EGP\s?850 is on its way by InstaPay\./);
    assert.match(refund.html, /Came back with the Training Tee\./);
    assert.doesNotMatch(refund.html, /Please hand it back/);
  });

  it('Refund Sent: the amount, the whole InstaPay number the customer gave (ATS-342), and the reference', () => {
    const email = renderReturnEmail(
      'return-refund-sent',
      request({ status: 'refund-sent', refundSentEgp: 580, refundReference: '88213' }),
      ctx,
    );
    assert.match(email.subject, /^Refund Sent: EGP\s?580 for #R-K7Q2M9$/);
    assert.match(email.html, /REFUND<br>SENT/);
    assert.match(email.text, /Amount: EGP\s?580\nSent by InstaPay to 010 1234 5678 · Reference 88213/);
    assert.match(email.html, /010 1234 5678/);
  });

  it('Rejected: the reason has a label and the gift stays, in both versions', () => {
    const email = renderReturnEmail(
      'return-rejected',
      request({ status: 'rejected', rejectReason: 'Worn.' }),
      ctx,
    );
    assert.match(email.html, /OUR REASON/);
    assert.match(email.html, /Stays with the Training Tee\./);
    assert.match(email.text, /Sport Socks: Free gift · Stays with the Training Tee\./);
    assert.doesNotMatch(email.text, /comes back with/);
  });

  it('Received: a mixed request mentions the new pieces and the refund', () => {
    const email = renderReturnEmail('return-received', request({ status: 'received' }), ctx);
    assert.match(
      email.text,
      /your new pieces are with you\. Your refund of EGP\s?580 is on its way by InstaPay\./,
    );
    assert.match(email.text, /Free gift · Came back with the Training Tee\./);
  });

  it('Approved: a wrong item hands over what we sent; quantities read naturally', () => {
    const email = renderReturnEmail(
      'return-approved',
      request({
        items: [
          {
            ...EXCHANGE,
            kind: 'wrong-item',
            wants: 'send-right-one',
            askedLabel: 'Wrong Item · Send the Right One',
          },
          { ...EXCHANGE, lineIndex: 3, quantity: 2, kind: 'damaged', askedLabel: 'Damaged · Send Another' },
        ],
        hasRefund: false,
        storeFault: true,
        feeEgp: 0,
        feePaid: 'free',
        refundEgp: 0,
      }),
      ctx,
    );
    assert.match(email.text, /Hand Over: the item we sent instead of Padel Shorts · M, 2 × Padel Shorts · M/);
    assert.match(email.text, /You Get: The right Padel Shorts, and 2 new Padel Shorts/);
  });

  it('Refund Sent to an InstaPay address shows the whole address', () => {
    const email = renderReturnEmail(
      'return-refund-sent',
      request({ status: 'refund-sent', refundSentEgp: 580, refundTo: 'mariamhassan@instapay' }),
      ctx,
    );
    assert.match(email.text, /Sent by InstaPay to mariamhassan@instapay/);
  });

  it('every status email has a plain-text version with the same facts in the same order', () => {
    const cases = [
      ['return-approved', request()],
      ['return-rejected', request({ status: 'rejected', rejectReason: 'Worn.' })],
      ['return-received', request({ status: 'received' })],
      ['return-refund-sent', request({ status: 'refund-sent', refundSentEgp: 580 })],
    ] as const;
    for (const [kind, req] of cases) {
      const email = renderReturnEmail(kind, req, ctx);
      const order = [
        'Return or Exchange · #R-K7Q2M9',
        kind === 'return-approved' ? 'Hand Over' : 'Your Items',
        'View Your Order',
      ];
      let last = -1;
      for (const fact of order) {
        const index = email.text.indexOf(fact);
        assert.ok(index > last, `${kind}: ${fact}`);
        last = index;
      }
      assert.ok(email.html.length > 0);
    }
  });
});

/** ATS-303: the shopper pays the courier fee by InstaPay before the courier comes. */
describe('courier fee paid by InstaPay first', () => {
  const payFirst = { feePaid: 'instapay-first', refundEgp: 650, cashAtDoorEgp: 0 };

  it('Approve with a fee sends the pay version; Payment Received sends its own email', () => {
    assert.deepEqual(returnEmailsForWrite(at('requested', payFirst), at('waiting-for-payment', payFirst)), [
      'return-approved',
    ]);
    assert.deepEqual(returnEmailsForWrite(at('waiting-for-payment', payFirst), at('approved', payFirst)), [
      'return-payment-received',
    ]);
    assert.deepEqual(returnEmailsForWrite(at('waiting-for-payment', payFirst), at('rejected', payFirst)), [
      'return-rejected',
    ]);
    assert.deepEqual(
      returnEmailsForWrite(at('waiting-for-payment', payFirst), at('cancelled', payFirst)),
      [],
    );
  });

  it('the pay version asks for the fee and does not send the courier yet', () => {
    const withDetails = { ...(ctx as object), instapay: { address: 'atteya@instapay', number: '' } } as never;
    const email = renderReturnEmail('return-approved', request(payFirst), withDetails);
    assert.match(email.html, /REQUEST<br>APPROVED/);
    assert.match(email.text, /Send EGP\s?70 by InstaPay/);
    assert.match(email.text, /InstaPay address: atteya@instapay/);
    assert.match(email.html, /Send Screenshot on WhatsApp/);
    assert.match(email.html, /View Your Order/);
    assert.doesNotMatch(email.text, /Our courier will come/);
    assert.match(email.text, /You Get: Padel Shorts in L, and EGP\s?650 by InstaPay once they're back/);
  });

  it('without InstaPay details the pay version says we send them on WhatsApp', () => {
    const email = renderReturnEmail('return-approved', request(payFirst), ctx);
    assert.match(email.text, /We'll send you the InstaPay details on WhatsApp\./);
  });

  it('Payment Received: we got the fee and the courier is coming', () => {
    const email = renderReturnEmail('return-payment-received', request(payFirst), ctx);
    assert.match(email.html, /PAYMENT<br>RECEIVED/);
    assert.match(email.text, /We got your EGP\s?70\. Our courier will come to your delivery address\./);
    assert.match(email.text, /Hand Over: Padel Shorts · M, Training Tee, Sport Socks/);
  });

  it('Request Sent and the staff alert say the fee is paid by InstaPay', () => {
    const sent = renderReturnEmail('return-requested', request(payFirst), ctx);
    assert.match(sent.text, /Once we approve it, you pay the EGP\s?70 courier fee by InstaPay\./);
    assert.match(sent.text, /Your refund: EGP\s?650/);
    const staff = renderReturnEmail('store-return-request', request(payFirst), ctx);
    assert.match(staff.text, /paid by InstaPay before pickup/);
  });
});

describe('courier fee sent back, reminder and automatic cancel (ATS-307)', () => {
  const payFirst = { feePaid: 'instapay-first', refundEgp: 650, cashAtDoorEgp: 0 };
  const approvedAt = { toMillis: () => Date.UTC(2026, 10, 14, 10, 0) };

  it('the fee reminder sends the shopper and staff reminders once', () => {
    const waiting = at('waiting-for-payment', payFirst);
    const reminded = at('waiting-for-payment', { ...payFirst, feeReminderSentAt: approvedAt });
    assert.deepEqual(returnEmailsForWrite(waiting, reminded), [
      'return-fee-reminder',
      'store-return-fee-reminder',
    ]);
    assert.deepEqual(returnEmailsForWrite(reminded, reminded), []);
  });

  it('only the automatic cancel sends "was cancelled"; the shopper cancel sends nothing', () => {
    const waiting = at('waiting-for-payment', payFirst);
    assert.deepEqual(returnEmailsForWrite(waiting, at('cancelled', { ...payFirst, cancelledBy: 'system' })), [
      'return-auto-cancelled',
    ]);
    assert.deepEqual(
      returnEmailsForWrite(waiting, at('cancelled', { ...payFirst, cancelledBy: 'shopper' })),
      [],
    );
  });

  it('Fee Sent Back sends its email once', () => {
    const rejected = at('rejected', { ...payFirst, feeBackEgp: 70 });
    const sent = at('rejected', {
      ...payFirst,
      feeBackEgp: 70,
      feeSentBackEgp: 70,
      feeSentBackTo: '010 1234 5678',
      feeSentBackAt: approvedAt,
    });
    assert.deepEqual(returnEmailsForWrite(rejected, sent), ['return-fee-sent-back']);
    assert.deepEqual(returnEmailsForWrite(sent, sent), []);
    assert.equal(returnClaimId('return-fee-sent-back', sent), 'k7q2m9abc_return-fee-sent-back');
  });

  it('the reminder says the cancel day and repeats the pay steps', () => {
    const email = renderReturnEmail(
      'return-fee-reminder',
      request({ ...payFirst, status: 'waiting-for-payment', waitingForPaymentAt: approvedAt }),
      ctx,
    );
    assert.equal(email.subject, 'Your return #R-K7Q2M9 is waiting for the courier fee');
    assert.match(email.html, /WAITING FOR<br>PAYMENT/);
    assert.match(email.text, /If it doesn't arrive by 19 Nov, we'll cancel the request\./);
    assert.match(email.text, /Send EGP\s?70 by InstaPay/);
    const staff = renderReturnEmail(
      'store-return-fee-reminder',
      request({ ...payFirst, status: 'waiting-for-payment', approvedAt }),
      ctx,
    );
    assert.match(staff.text, /Still waiting for the courier fee\. If it arrived, press Payment Received\./);
  });

  it('the automatic cancel and Fee Sent Back emails', () => {
    const cancelled = renderReturnEmail('return-auto-cancelled', at('cancelled', payFirst), ctx);
    assert.equal(cancelled.subject, 'Your return #R-K7Q2M9 was cancelled');
    assert.match(cancelled.html, /REQUEST<br>CANCELLED/);
    assert.match(cancelled.text, /If you already sent the fee, message us on WhatsApp\./);
    assert.match(cancelled.html, /Message Us on WhatsApp/);
    const back = renderReturnEmail(
      'return-fee-sent-back',
      at('rejected', {
        ...payFirst,
        feeBackEgp: 70,
        feeSentBackEgp: 70,
        feeSentBackTo: '010 1234 5678',
        feeSentBackReference: 'TX9',
      }),
      ctx,
    );
    assert.equal(back.subject, 'We sent your courier fee back for #R-K7Q2M9');
    assert.match(back.html, /FEE SENT<br>BACK/);
    assert.match(back.text, /We sent your EGP\s?70 courier fee back by InstaPay to …5678\./);
    assert.match(back.text, /Reference: TX9/);
  });

  it('the Rejected email says the fee comes back while it is still to send', () => {
    const email = renderReturnEmail('return-rejected', at('rejected', { ...payFirst, feeBackEgp: 70 }), ctx);
    assert.match(email.text, /We'll send your EGP\s?70 courier fee back by InstaPay\./);
    const none = renderReturnEmail('return-rejected', at('rejected', payFirst), ctx);
    assert.doesNotMatch(none.text, /courier fee back/);
  });
});

describe('returns started by staff for the customer (ATS-342)', () => {
  it('send no Request Sent or staff alert, then Approved as usual', () => {
    const started = request({ status: 'requested', startedByStaff: true });
    assert.deepEqual(returnEmailsForWrite(null, started), []);
    assert.deepEqual(returnEmailsForWrite(started, request({ status: 'approved', startedByStaff: true })), [
      'return-approved',
    ]);
  });

  it('Approved shows the refund with the whole InstaPay number', () => {
    const email = renderReturnEmail('return-approved', request({ startedByStaff: true }), ctx);
    assert.match(email.text, /Your refund: EGP\s?580/);
    assert.match(email.text, /send it by InstaPay to 010 1234 5678/);
    assert.match(email.text, /Not yours\? Message us on WhatsApp/);
    assert.match(email.text, /As we agreed, your return of 2 items is approved\./);
  });
});
