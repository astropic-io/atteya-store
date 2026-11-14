import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { adminCallableOptions } from '../auth/callable-options.js';
import { orderSearchTokens } from '../store/order-search.js';
import { identifyOrderCustomer, orderCustomerFields, requireCustomerTerms } from './order-customer.js';
import { parseCreateStoreOrderRequest } from './order-request.js';
import { priceStoreOrder, type OrderPricingSnapshot } from './order-pricing.server.js';
import { readOfferUses, savedOfferUses } from './offer-usage.js';
import { utcDayKey } from './order-rate-limit.js';
import { logGuestStoreCapReached, readOrderRateLimits } from './order-rate-limit-docs.js';
import { newOrderViewKey } from './order-view.js';
import { currencyFromCountry } from '../intl/currency-from-country.js';
import { withPayIn } from './pay-in-order.js';
import { orderStaffNotesRef } from './order-staff-notes.js';
import { isBankTransferLive } from '../store/store-info.js';

/**
 * Orders paid outside Paymob and confirmed by staff (`setOrderStatus` / `confirmCodOrder`):
 * Cash on Delivery and InstaPay in Egypt, Bank Transfer outside Egypt.
 */
export type ManualPaymentMethod = 'cash-on-delivery' | 'instapay' | 'bank-transfer';

export interface CreateManualOrderResponse<M extends ManualPaymentMethod = ManualPaymentMethod> {
  readonly orderId: string;
  readonly status: 'pending';
  readonly paymentMethod: M;
  readonly pricing: OrderPricingSnapshot;
  /** A guest order's secret view key (for `?key=` on the order page); null when signed in. */
  readonly viewKey: string | null;
}

export type CreateCodOrderResponse = CreateManualOrderResponse<'cash-on-delivery'>;
export type CreateInstapayOrderResponse = CreateManualOrderResponse<'instapay'>;
export type CreateBankTransferOrderResponse = CreateManualOrderResponse<'bank-transfer'>;

/** Where each method can be used: true = Egypt only, false = outside Egypt only. */
const EGYPT_ONLY: Record<ManualPaymentMethod, boolean> = {
  'cash-on-delivery': true,
  instapay: true,
  'bank-transfer': false,
};

const WRONG_COUNTRY: Record<ManualPaymentMethod, string> = {
  'cash-on-delivery': 'Cash on Delivery is only available for orders delivered in Egypt.',
  instapay: 'InstaPay is only available for orders delivered in Egypt.',
  'bank-transfer': 'Bank Transfer is only available for orders delivered outside Egypt.',
};

/**
 * Egypt cash on delivery. The shopper pays the shipping fee first by InstaPay, then the rest in
 * cash on delivery. Admin `confirmCodOrder` (fee received) takes the items out of stock.
 */
export const createCodOrder = onCall(adminCallableOptions(), (request) =>
  createManualOrder(request, 'cash-on-delivery'),
);

/**
 * Egypt InstaPay. The shopper transfers the full total and sends the screenshot on WhatsApp;
 * admin `confirmCodOrder` (money seen in the bank app) takes the items out of stock.
 */
export const createInstapayOrder = onCall(adminCallableOptions(), (request) =>
  createManualOrder(request, 'instapay'),
);

/**
 * Outside Egypt. The shopper sends the total in the delivery country's currency, the one checkout
 * showed them (`pricing.payIn`, ATS-309: never EGP, whatever currency they browsed in)
 * from their bank to our IBAN and sends the receipt on WhatsApp; staff confirm once the money
 * arrives, which takes the items out of stock. Refused while no IBAN is set (`isBankTransferLive()`).
 */
export const createBankTransferOrder = onCall(adminCallableOptions(), (request) =>
  createManualOrder(request, 'bank-transfer'),
);

/**
 * Creates a pending order. Stock is checked while pricing but not taken until staff confirm.
 */
async function createManualOrder<M extends ManualPaymentMethod>(
  request: CallableRequest,
  method: M,
): Promise<CreateManualOrderResponse<M>> {
  const customer = await identifyOrderCustomer(request);
  await requireCustomerTerms(customer);
  const input = parseCreateStoreOrderRequest({
    ...(isRecord(request.data) ? request.data : {}),
    paymentMethod: method,
  });
  if ((input.shipping.country === 'EG') !== EGYPT_ONLY[method]) {
    throw new HttpsError('failed-precondition', WRONG_COUNTRY[method]);
  }
  if (method === 'bank-transfer' && !isBankTransferLive()) {
    throw new HttpsError(
      'failed-precondition',
      "Bank Transfer isn't available right now. Please message us on WhatsApp to order.",
    );
  }

  const db = getFirestore();
  const priced = await priceStoreOrder(db, input, customer.signedIn, customer.offerKeys);
  const { pricing, payInRate } =
    method === 'bank-transfer'
      ? await withPayIn(
          db,
          priced.pricing,
          currencyFromCountry(input.shipping.country),
          'bank-transfer',
          input.shownPayIn,
        )
      : { pricing: priced.pricing, payInRate: null };
  const orderRef = db.collection('orders').doc();
  const viewKey = customer.kind === 'guest' ? newOrderViewKey() : null;
  const day = utcDayKey();

  // Set inside the transaction (which may retry) and logged once after it commits.
  let filledGuestStoreCap = false;
  await db.runTransaction(async (tx) => {
    const rateLimits = await readOrderRateLimits(tx, db, customer, day);
    filledGuestStoreCap = rateLimits.filledGuestStoreCap;
    // Offer limits (every offer type with a limit): an order counts once per offer, however many items it has.
    const addOfferUses = await readOfferUses(tx, db, customer.offerKeys, priced.usedOffers);
    const now = FieldValue.serverTimestamp();
    const switchedOffIds = addOfferUses();
    rateLimits.write();

    tx.set(orderRef, {
      id: orderRef.id,
      status: 'pending',
      paymentMethod: method,
      ...orderCustomerFields(customer, viewKey, now),
      searchTokens: orderSearchTokens({
        orderId: orderRef.id,
        fullName: input.shipping.fullName,
        phone: input.shipping.phone,
        email: customer.email,
      }),
      shipping: {
        ...input.shipping,
        boxId: priced.pricing.shipping?.boxId ?? null,
      },
      pricing,
      // What cancelOrder gives back if staff cancel this order (null: no offer counted).
      offerUses: savedOfferUses(customer.offerKeys, priced.usedOffers, switchedOffIds),
      paymob: null,
      confirmedAt: null,
      confirmedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    // Staff-only: the owner can read orders/{id} (and guests its orderViews copy), so the abroad
    // markup and rate behind payIn go to orderStaffNotes (ATS-304).
    if (payInRate) {
      tx.set(orderStaffNotesRef(db, orderRef.id), { payInRate, updatedAt: now }, { merge: true });
    }
  });
  if (filledGuestStoreCap) logGuestStoreCapReached(day);

  return {
    orderId: orderRef.id,
    status: 'pending',
    paymentMethod: method,
    pricing,
    viewKey,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
