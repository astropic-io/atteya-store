import {
  ABROAD_PHONE_MESSAGE,
  DELIVERY_FIELD_MESSAGES,
  EGYPT_PHONE_MESSAGE,
  isEgyptMobile,
  PAYER_FIELD_MESSAGES,
  shopperWhatsappNumber,
} from '@core/config/order-messages';
import type { CheckoutPayerInput, CheckoutShippingInput } from '@core/services/orders/checkout-order.service';
import { isCheckoutCountry } from './checkout-countries';

/**
 * Checkout fields that must be filled in before Place Order (the governorate has its own picker).
 * `payer…`: the shopper's own details when they pay from abroad for delivery to someone in Egypt.
 */
export type CheckoutField =
  'email' | 'payerName' | 'payerPhone' | 'payerCountry' | 'fullName' | 'line1' | 'city' | 'phone';

/** Page order: the first field with an error gets the cursor. */
export const CHECKOUT_FIELD_ORDER: readonly CheckoutField[] = [
  'email',
  'payerName',
  'payerPhone',
  'payerCountry',
  'fullName',
  'line1',
  'city',
  'phone',
];

/** Fields shown above the Egypt Governorate field. */
export const FIELDS_ABOVE_GOVERNORATE: ReadonlySet<CheckoutField> = new Set([
  'email',
  'payerName',
  'payerPhone',
  'payerCountry',
  'fullName',
]);

/**
 * Paid from abroad for delivery to someone in Egypt: the message under each of the shopper's own
 * fields that is empty or wrong (the same text the order callables send).
 */
export function payerFieldErrors(payer: CheckoutPayerInput): CheckoutFieldErrors {
  const errors: CheckoutFieldErrors = {};
  if (!payer.fullName.trim()) errors.payerName = PAYER_FIELD_MESSAGES.fullName;
  const countryOk = isCheckoutCountry(payer.country) && payer.country !== 'EG';
  if (!countryOk) errors.payerCountry = PAYER_FIELD_MESSAGES.country;
  if (!payer.phone.trim() || shopperWhatsappNumber(payer.phone, countryOk ? payer.country : 'XX') === null) {
    errors.payerPhone = ABROAD_PHONE_MESSAGE;
  }
  return errors;
}

export type CheckoutFieldErrors = Partial<Record<CheckoutField, string>>;

/** The `id` of a field's input on the checkout page. */
export function checkoutFieldId(field: CheckoutField): string {
  return `checkout-${field}`;
}

/**
 * The message under each required field that is empty or wrong (ATS-318), with the same text the
 * order callables send. Only what we need to deliver and reach the shopper is required: postal code,
 * address line 2 and region are optional. `guestEmailText` is null for a signed-in shopper.
 */
export function checkoutFieldErrors(
  draft: CheckoutShippingInput,
  guestEmailText: string | null,
  guestEmailOk: boolean,
): CheckoutFieldErrors {
  const errors: CheckoutFieldErrors = {};
  if (guestEmailText !== null && !guestEmailOk) {
    errors.email = guestEmailText.trim()
      ? 'Check your email address.'
      : 'Enter your email to place your order.';
  }
  if (!draft.fullName.trim()) errors.fullName = DELIVERY_FIELD_MESSAGES.fullName;
  if (!draft.line1.trim()) errors.line1 = DELIVERY_FIELD_MESSAGES.line1;
  // In Egypt the governorate fills the city; the Governorate field shows its own message.
  if (draft.country !== 'EG' && !draft.city.trim()) errors.city = DELIVERY_FIELD_MESSAGES.city;
  if (!draft.phone.trim()) {
    errors.phone = DELIVERY_FIELD_MESSAGES.phone;
  } else if (draft.country === 'EG' && !isEgyptMobile(draft.phone)) {
    // We reach Egypt shoppers on WhatsApp (InstaPay screenshot, cash-on-delivery fee).
    errors.phone = EGYPT_PHONE_MESSAGE;
  } else if (draft.country !== 'EG' && shopperWhatsappNumber(draft.phone, draft.country) === null) {
    // Abroad we agree delivery and payment on WhatsApp, so the number needs its country code.
    errors.phone = ABROAD_PHONE_MESSAGE;
  }
  return errors;
}
