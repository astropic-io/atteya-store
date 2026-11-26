import { HttpsError } from 'firebase-functions/v2/https';
import * as v from 'valibot';
import { governorateOfAddress, isDeliveryCountry } from '../offers/engine/index.js';
import {
  ABROAD_PHONE_MESSAGE,
  DELIVERY_FIELD_MESSAGES,
  EGYPT_PHONE_MESSAGE,
  isEgyptMobile,
  PAYER_FIELD_MESSAGES,
  shopperWhatsappNumber,
} from '../store/order-messages.js';

const COUNTRY_CODE = /^[A-Z]{2}$/;
const MAX_LINES = 20;
const MAX_QTY = 20;
const MAX_NAME = 120;
const MAX_LINE = 200;
const MAX_CITY = 80;
const MAX_POSTAL = 20;
const MAX_PHONE = 20;
const MAX_SELECTION_KEYS = 8;
/** Most gift picks on one bag line; matches `MAX_OFFER_GIFTS` in the offer engine. */
const MAX_LINE_GIFTS = 5;
/** Most offer ids in one of checkout's offer id lists. */
const MAX_ENDED_OFFERS = 20;
export type StorePaymentMethod = 'paymob' | 'cash-on-delivery' | 'instapay' | 'bank-transfer';

export interface OrderLineInput {
  readonly productId: string;
  readonly variantId: string | null;
  readonly quantity: number;
  readonly selection: Readonly<Record<string, string>>;
  /** Free gifts the shopper picked for this line (one set per piece). Re-checked on the server. */
  readonly gifts: readonly OrderGiftPickInput[];
  /**
   * The price of one piece checkout showed (whole EGP, after per-item offers, before Buy X Get Y),
   * or null when checkout didn't send one (older pages). When the server's price is higher, the
   * order is refused instead of charging more than the shopper saw. Never lowers a price.
   */
  readonly shownUnitEgp: number | null;
  /** The per-item offer checkout priced that piece with, or null for none. */
  readonly shownOfferId: string | null;
  /**
   * The price of one piece before per-item offers checkout showed (whole EGP), or null. Pieces in
   * a Buy X Get Y group pay this price, so the order is refused when it went up. Never lowers a
   * price.
   */
  readonly shownBaseEgp: number | null;
}

/** One free gift picked on a bag line: which offer and gift, which product, and its size. */
export interface OrderGiftPickInput {
  readonly offerId: string;
  readonly giftId: string;
  readonly productId: string;
  /** Size value id when the gift product has sizes, else null. */
  readonly sizeId: string | null;
}

export interface OrderShippingInput {
  readonly fullName: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly postalCode: string;
  readonly country: string;
  readonly phone: string;
  /**
   * Egypt: the governorate id from `EGYPT_GOVERNORATES` (ATS-306), and `city` is its English name.
   * Whether we deliver there is checked while pricing (`priceStoreOrder`). Null abroad.
   */
  readonly governorateId: string | null;
}

/**
 * The shopper paying from abroad for an order delivered to someone in Egypt: `shipping` is the
 * recipient's Egypt address and Egyptian mobile; this is who pays and who we message about payment.
 */
export interface OrderPayerInput {
  readonly fullName: string;
  /** Their WhatsApp number with its country code (`shopperWhatsappNumber()` can read it). */
  readonly phone: string;
  /** Where they pay from (never `EG`): decides the currency they pay in. */
  readonly country: string;
}

export interface CreateStoreOrderRequest {
  readonly lines: readonly OrderLineInput[];
  readonly shipping: OrderShippingInput;
  /**
   * Set when a shopper outside Egypt pays for an order delivered to someone in Egypt: items at
   * abroad prices in their currency, the Egypt delivery fee for `shipping`, Bank Transfer only.
   * Missing or null for every other order.
   */
  readonly payer?: OrderPayerInput | null;
  readonly paymentMethod: StorePaymentMethod;
  /**
   * Buy X Get Y offers checkout already told the shopper have ended (from an earlier refusal) and
   * left out of the total it shows. The server leaves one out only when its usage counts confirm it has
   * no use left for this shopper (`confirmedEndedOfferIds`); any other id is ignored.
   */
  readonly endedOfferIds: readonly string[];
  /**
   * Buy X Get Y offers the bag priced this order with. One the server doesn't apply (after reading
   * the offers again without the cache) refuses the order (`details.changedOfferId`) instead of
   * charging more than the shopper saw. Never adds a discount.
   */
  readonly dealOfferIds: readonly string[];
  /**
   * The shipping fee checkout showed (whole EGP), or null when it didn't send one (older pages, or
   * a large order whose fee is agreed later). The order is refused when the server's fee is higher,
   * or, when this is null but `shownTotalEgp` is set (checkout showed a fee to be agreed), when the
   * server charges any shipping fee. Never lowers a price.
   */
  readonly shownShippingEgp: number | null;
  /**
   * The order total checkout showed (whole EGP, items plus shipping; only the items while the fee is
   * to be agreed), or null. The order is refused when the server's `totalEgp` is higher. Never
   * lowers a price.
   */
  readonly shownTotalEgp: number | null;
  /**
   * Orders shipped abroad (ATS-311): the total checkout showed in the shopper's currency, or null.
   * The order is refused when the server's `payIn.amount` in the same currency is higher (the
   * factors changed since checkout read them). Never lowers a price.
   */
  readonly shownPayIn: ShownPayIn | null;
}

export interface ShownPayIn {
  readonly currency: string;
  readonly amount: number;
}

/** Longest email address a guest can order with (RFC 5321 path limit). */
const MAX_GUEST_EMAIL = 254;

/**
 * The `guest` block of a call with no sign-in: `{ email }`, trimmed and lower-cased so the same
 * address always gives the same rate-limit and offer-limit keys.
 */
export const GuestCheckoutSchema = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(MAX_GUEST_EMAIL), v.email()),
});

export type GuestCheckoutInput = v.InferOutput<typeof GuestCheckoutSchema>;

/** The guest's email from a call with no sign-in, or null when the block is missing or invalid. */
export function parseGuestCheckout(raw: unknown): GuestCheckoutInput | null {
  const result = v.safeParse(GuestCheckoutSchema, raw);
  return result.success ? result.output : null;
}

export function parseCreateStoreOrderRequest(data: unknown): CreateStoreOrderRequest {
  if (!isRecord(data)) {
    throw new HttpsError('invalid-argument', 'Your order could not be read. Refresh and try again.');
  }
  const lines = parseLines(data['lines']);
  const shipping = parseShipping(data['shipping']);
  const payer = parsePayer(data['payer'], shipping.country);
  const paymentMethod = parsePaymentMethod(data['paymentMethod'], shipping.country, payer !== null);
  // Staff reach Egypt shoppers on WhatsApp (InstaPay screenshot, cash-on-delivery fee).
  if (shipping.country === 'EG' && !isEgyptMobile(shipping.phone)) {
    throw new HttpsError('invalid-argument', EGYPT_PHONE_MESSAGE);
  }
  // Abroad we agree delivery and payment on WhatsApp (ATS-314): the number must be one we can open.
  if (shipping.country !== 'EG' && shopperWhatsappNumber(shipping.phone, shipping.country) === null) {
    throw new HttpsError('invalid-argument', ABROAD_PHONE_MESSAGE);
  }
  const endedOfferIds = parseOfferIds(data['endedOfferIds']);
  const dealOfferIds = parseOfferIds(data['dealOfferIds']);
  const shownShippingEgp = parseShownAmountEgp(data['shownShippingEgp']);
  const shownTotalEgp = parseShownAmountEgp(data['shownTotalEgp']);
  const shownPayIn = parseShownPayIn(data['shownPayIn']);
  return {
    lines,
    shipping,
    payer,
    paymentMethod,
    endedOfferIds,
    dealOfferIds,
    shownShippingEgp,
    shownTotalEgp,
    shownPayIn,
  };
}

/** The shopper-currency total checkout showed, or null when missing or unreadable (no comparison). */
export function parseShownPayIn(raw: unknown): ShownPayIn | null {
  if (!isRecord(raw)) return null;
  const currency = raw['currency'];
  const amount = raw['amount'];
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_SHOWN_AMOUNT_EGP) {
    return null;
  }
  return { currency, amount };
}

/** Most whole EGP a shown shipping fee or order total can be; anything above is read as not sent. */
const MAX_SHOWN_AMOUNT_EGP = 1_000_000_000;

/**
 * The shipping fee or order total checkout showed, or null when it is missing or unreadable (the
 * comparison is then skipped). Rounded down, and only ever used to refuse an order, so a wrong value
 * can't lower a price.
 */
export function parseShownAmountEgp(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > MAX_SHOWN_AMOUNT_EGP) return null;
  return Math.floor(raw);
}

/**
 * A list of offer ids from checkout (`endedOfferIds`, `dealOfferIds`); anything unreadable is left
 * out. The server checks each id itself before it changes anything.
 */
export function parseOfferIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  for (const entry of raw) {
    if (ids.size >= MAX_ENDED_OFFERS) break;
    if (typeof entry === 'string' && entry.length >= 1 && entry.length <= 128) ids.add(entry);
  }
  return Array.from(ids);
}

/** Paying from abroad for delivery in Egypt is paid by Bank Transfer only. */
export const PAID_FROM_ABROAD_METHOD_MESSAGE =
  'When you pay from outside Egypt for delivery in Egypt, pay by Bank Transfer.';

/**
 * The `payer` block (paid from abroad, delivered in Egypt), or null when it is missing. Only for an
 * Egypt delivery address; the shopper's name, a country outside Egypt and a WhatsApp number with
 * its country code are required.
 */
export function parsePayer(raw: unknown, shippingCountry: string): OrderPayerInput | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) {
    throw new HttpsError('invalid-argument', 'Your details could not be read. Refresh and try again.');
  }
  if (shippingCountry !== 'EG') {
    throw new HttpsError(
      'invalid-argument',
      'Choose Deliver to Someone in Egypt again, or enter your own address abroad.',
    );
  }
  const countryRaw = typeof raw['country'] === 'string' ? raw['country'].trim().toUpperCase() : '';
  if (!COUNTRY_CODE.test(countryRaw) || !isDeliveryCountry(countryRaw) || countryRaw === 'EG') {
    throw new HttpsError('invalid-argument', PAYER_FIELD_MESSAGES.country);
  }
  const fullName = readText(raw['fullName'], MAX_NAME, PAYER_FIELD_MESSAGES.fullName);
  const phone = readText(raw['phone'], MAX_PHONE, ABROAD_PHONE_MESSAGE);
  if (shopperWhatsappNumber(phone, countryRaw) === null) {
    throw new HttpsError('invalid-argument', ABROAD_PHONE_MESSAGE);
  }
  return { fullName, phone, country: countryRaw };
}

function parsePaymentMethod(raw: unknown, country: string, paidFromAbroad: boolean): StorePaymentMethod {
  if (raw !== 'paymob' && raw !== 'cash-on-delivery' && raw !== 'instapay' && raw !== 'bank-transfer') {
    throw new HttpsError('invalid-argument', 'Choose how you want to pay.');
  }
  if (paidFromAbroad) {
    if (raw !== 'bank-transfer') throw new HttpsError('failed-precondition', PAID_FROM_ABROAD_METHOD_MESSAGE);
    return raw;
  }
  if (raw === 'cash-on-delivery' && country !== 'EG') {
    throw new HttpsError(
      'failed-precondition',
      'Cash on Delivery is only available for orders delivered in Egypt.',
    );
  }
  if (raw === 'instapay' && country !== 'EG') {
    throw new HttpsError('failed-precondition', 'InstaPay is only available for orders delivered in Egypt.');
  }
  if (raw === 'bank-transfer' && country === 'EG') {
    throw new HttpsError(
      'failed-precondition',
      'Bank Transfer is only available for orders delivered outside Egypt.',
    );
  }
  return raw;
}

function parseLines(raw: unknown): OrderLineInput[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) {
    throw new HttpsError('invalid-argument', 'Add at least one item to your bag before checking out.');
  }
  const lines: OrderLineInput[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      throw new HttpsError('invalid-argument', 'One bag item could not be read. Refresh and try again.');
    }
    const productId = readId(entry['productId']);
    const variantId = readOptionalId(entry['variantId']);
    const quantity = readQuantity(entry['quantity']);
    const selection = parseSelection(entry['selection']);
    const gifts = parseGiftPicks(entry['gifts']);
    const shownUnitEgp = parseShownUnitEgp(entry['shownUnitEgp']);
    const shownOfferId = parseShownOfferId(entry['shownOfferId']);
    const shownBaseEgp = parseShownUnitEgp(entry['shownBaseEgp']);
    lines.push({
      productId,
      variantId,
      quantity,
      selection,
      gifts,
      shownUnitEgp,
      shownOfferId,
      shownBaseEgp,
    });
  }
  return lines;
}

/** Most whole EGP one piece can show at checkout; anything above is read as not sent. */
const MAX_SHOWN_UNIT_EGP = 10_000_000;

/**
 * The unit price checkout showed for a line, or null when it is missing or unreadable (the
 * comparison is then skipped). Only ever used to refuse an order, so a wrong value can't lower a
 * price.
 */
export function parseShownUnitEgp(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > MAX_SHOWN_UNIT_EGP) return null;
  // Rounded down, so a fraction can never let the order cost more than the page showed.
  return Math.floor(raw);
}

/** The per-item offer id checkout showed for a line, or null. */
export function parseShownOfferId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length >= 1 && raw.length <= 128 ? raw : null;
}

/** Gift picks of one line. Every pick on a line must name the same offer. */
export function parseGiftPicks(raw: unknown): OrderGiftPickInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_LINE_GIFTS) {
    throw new HttpsError(
      'invalid-argument',
      'The free gifts in your bag could not be read. Choose them again.',
    );
  }
  const picks: OrderGiftPickInput[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      throw new HttpsError(
        'invalid-argument',
        'The free gifts in your bag could not be read. Choose them again.',
      );
    }
    picks.push({
      offerId: readGiftId(entry['offerId']),
      giftId: readGiftId(entry['giftId']),
      productId: readGiftId(entry['productId']),
      sizeId:
        entry['sizeId'] === null || entry['sizeId'] === undefined || entry['sizeId'] === ''
          ? null
          : readGiftId(entry['sizeId']),
    });
  }
  if (picks.some((pick) => pick.offerId !== picks[0]?.offerId)) {
    throw new HttpsError(
      'invalid-argument',
      'The free gifts in your bag could not be read. Choose them again.',
    );
  }
  return picks;
}

function readGiftId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 128) {
    throw new HttpsError(
      'invalid-argument',
      'The free gifts in your bag could not be read. Choose them again.',
    );
  }
  return raw;
}

function parseSelection(raw: unknown): Readonly<Record<string, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= MAX_SELECTION_KEYS) break;
    if (typeof key !== 'string' || key.length === 0 || key.length > 40) continue;
    if (typeof value !== 'string' || value.length === 0 || value.length > 80) continue;
    out[key] = value;
    count++;
  }
  return out;
}

function parseShipping(raw: unknown): OrderShippingInput {
  if (!isRecord(raw)) {
    throw new HttpsError('invalid-argument', 'Enter your delivery address to continue.');
  }
  const country = readCountry(raw['country']);
  const fullName = readText(raw['fullName'], MAX_NAME, DELIVERY_FIELD_MESSAGES.fullName);
  const line1 = readText(raw['line1'], MAX_LINE, DELIVERY_FIELD_MESSAGES.line1);
  const line2 = readOptionalText(raw['line2'], MAX_LINE);
  // Egypt: the governorate picked from the list decides the city (and the delivery fee). A checkout
  // page opened before the Governorate field sends only a typed city: it counts when it names a
  // governorate exactly. Anything else is refused like a missing governorate.
  const governorate =
    country === 'EG'
      ? governorateOfAddress(
          readOptionalText(raw['governorateId'], 40),
          readOptionalText(raw['city'], MAX_CITY),
        )
      : null;
  if (country === 'EG' && !governorate) {
    throw new HttpsError('invalid-argument', 'Choose your governorate.');
  }
  const city = governorate ? governorate.name : readText(raw['city'], MAX_CITY, DELIVERY_FIELD_MESSAGES.city);
  const region = governorate ? null : readOptionalText(raw['region'], MAX_CITY);
  // Optional for every country (ATS-318): many countries have no postal codes. Egypt never keeps one.
  const postalCode = country === 'EG' ? '' : readPostalCode(raw['postalCode']);
  const phone = readText(raw['phone'], MAX_PHONE, DELIVERY_FIELD_MESSAGES.phone);
  return {
    fullName,
    line1,
    line2,
    city,
    region,
    postalCode,
    country,
    phone,
    governorateId: governorate ? governorate.id : null,
  };
}

function readCountry(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new HttpsError('invalid-argument', 'Choose a delivery country.');
  }
  const code = raw.trim().toUpperCase();
  // Any real country can be ordered to (ATS-314); the shipping settings decide its fee.
  if (!COUNTRY_CODE.test(code) || !isDeliveryCountry(code)) {
    throw new HttpsError('invalid-argument', 'Choose a valid delivery country.');
  }
  return code;
}

function readId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < 2 || raw.length > 80) {
    throw new HttpsError('invalid-argument', 'One bag item could not be read. Refresh and try again.');
  }
  return raw;
}

function readOptionalId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return readId(raw);
}

function readQuantity(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_QTY) {
    throw new HttpsError('invalid-argument', 'Choose a quantity between 1 and 20 for each item.');
  }
  return raw;
}

function readText(raw: unknown, max: number, message: string): string {
  if (typeof raw !== 'string') throw new HttpsError('invalid-argument', message);
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new HttpsError('invalid-argument', message);
  }
  return trimmed;
}

/** Optional postal code abroad: empty or missing is fine, too long is refused (never dropped). */
function readPostalCode(raw: unknown): string {
  if (raw === null || raw === undefined || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length > MAX_POSTAL) {
    throw new HttpsError('invalid-argument', `Postal codes are ${MAX_POSTAL} characters or fewer.`);
  }
  return trimmed;
}

function readOptionalText(raw: unknown, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The country whose currency a Bank Transfer is paid in: the payer's when the order is paid from
 * abroad for delivery in Egypt (the recipient's Egypt address doesn't decide it), else the address's.
 */
export function payInCountryOf(input: Pick<CreateStoreOrderRequest, 'payer' | 'shipping'>): string {
  return input.payer?.country ?? input.shipping.country;
}
