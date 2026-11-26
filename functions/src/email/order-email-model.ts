/**
 * Reads a stored order into the facts order emails need. Pure: no Firestore,
 * no params, so the templates and the choice of email can be unit tested.
 *
 * Every amount comes from the saved order in whole Egyptian pounds:
 * `pricing.subtotalEgp`, `pricing.shipping.priceEgp`, `pricing.totalEgp`.
 * Shopper emails show `shopper` (ATS-309): EGP for an Egypt order, and only the shopper's own
 * currency (`pricing.payIn`) for an order shipped abroad, never EGP or the Egypt price. The staff
 * alert shows EGP for an Egypt order; for one shipped abroad it leads with the shopper's currency,
 * then what it comes to in pounds (`staffRate`), then the Egypt price (ATS-320).
 */
import { dealTag } from '../offers/engine/buy-x-get-y.js';
import { shopperMoney, type ShopperMoney, type ShopperMoneyLine } from '../offers/engine/shopper-money.js';
import { isDeliveryFeeToBeAgreed, readPayIn, type PayIn } from '../store/order-messages.js';

export type OrderEmailPaymentMethod = 'paymob' | 'cash-on-delivery' | 'instapay' | 'bank-transfer';
export type OrderEmailStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'failed';

export interface OrderEmailLine {
  readonly productId: string;
  readonly name: string;
  readonly optionLabels: readonly { readonly label: string; readonly value: string }[];
  readonly imagePath: string | null;
  readonly quantity: number;
  readonly lineEgp: number;
  /** Free gift line (price 0, listed after its item): the gift's name, e.g. "Free shirt". */
  readonly giftName: string | null;
  /** Buy X Get Y discount on the line ("Free", "1 free", "−50%"); `lineEgp` is after it. */
  readonly dealTag: string | null;
  /** The line in the order's `shopper` currency (`lineEgp` for an Egypt order); null = no price shown. */
  readonly shopperAmount: number | null;
}

/**
 * Staff-only: the abroad markup and the plain rate behind `pricing.payIn.factor`
 * (`orderStaffNotes/{orderId}.payInRate`, ATS-304), so the staff alert can say what an amount in the
 * shopper's currency comes to in pounds. Never on the order doc (its owner can read that).
 */
export interface OrderEmailStaffRate {
  readonly markupPercent: number;
  /** Shopper currency per 1 EGP, before the markup. */
  readonly rate: number;
}

export interface OrderEmailAddress {
  readonly fullName: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly postalCode: string;
  readonly country: string;
  readonly phone: string;
}

/** The shopper paying from abroad for an order delivered to someone in Egypt. */
export interface OrderEmailPayer {
  readonly fullName: string;
  readonly phone: string;
  readonly country: string;
}

export interface OrderEmailOrder {
  readonly id: string;
  /** `#A1B2C3`: the same short number the site and dashboard show. */
  readonly ref: string;
  readonly status: OrderEmailStatus;
  readonly paymentMethod: OrderEmailPaymentMethod;
  readonly customerEmail: string | null;
  readonly isInternational: boolean;
  /**
   * Shipped abroad, or paid from abroad for delivery to someone in Egypt (`pricing.paidFromCountry`):
   * shopper amounts are in the currency they pay in (`shopper`), never EGP.
   */
  readonly paysInOtherCurrency: boolean;
  /** Paid from abroad for delivery in Egypt: the country it is paid from (`pricing.paidFromCountry`). */
  readonly paidFromCountry: string | null;
  /** Paid from abroad: who pays (the address is the recipient in Egypt). Null for every other order. */
  readonly payer: OrderEmailPayer | null;
  readonly address: OrderEmailAddress;
  readonly lines: readonly OrderEmailLine[];
  readonly subtotalEgp: number;
  readonly shippingEgp: number;
  readonly totalEgp: number;
  /** Paid (Paymob) while an item had already sold out (see paymobWebhook). */
  readonly needsReview: boolean;
  /**
   * Delivery fee staff haven't set yet: a large Egypt order, or an order abroad whose delivery is
   * still to be confirmed (`international-agreed`, ATS-314). `shippingEgp` is then 0 and
   * `totalEgp` is the items only; emails say the fee is to be agreed instead of showing them.
   */
  readonly feeToBeAgreed: boolean;
  /**
   * Delivery fee staff have saved after agreeing it on WhatsApp (`domestic-agreed` or
   * `international-agreed`, with `feeAgreed`).
   */
  readonly deliveryFeeAgreed: boolean;
  /** When staff last saved the delivery fee (`deliveryFeeSetAt`, epoch ms), or null. */
  readonly deliveryFeeSetAtMs: number | null;
  /** When staff marked the order Shipped (`shippedAt`, epoch ms), or null. */
  readonly shippedAtMs: number | null;
  /** When staff marked the order Delivered (`deliveredAt`, epoch ms), or null. */
  readonly deliveredAtMs: number | null;
  /** When staff last reopened the order after a cancel (`reopenedAt`, epoch ms), or null. */
  readonly reopenedAtMs: number | null;
  /** A guest order's secret view key (its links carry `?key=`); null for signed-in orders. */
  readonly viewKey: string | null;
  /** Bank Transfer: the amount to send in the shopper's currency (`pricing.payIn`), or null. */
  readonly payIn: PayIn | null;
  /**
   * Card (Paymob) order shipped abroad: the whole pounds Paymob charges (`pricing.chargeEgp`,
   * ATS-311), which differs from the Egypt price `totalEgp`. Null when not saved (Egypt orders).
   */
  readonly chargeEgp: number | null;
  /** When the order was placed (`createdAt`, epoch ms), or null. */
  readonly createdAtMs: number | null;
  /** True when the order has no account (`customerId` empty): a guest checkout. */
  readonly guestCheckout: boolean;
  /** The shipping box the server picked (`pricing.shipping.boxId`, e.g. `box1`), or null. */
  readonly boxId: string | null;
  /**
   * What shopper emails show (ATS-309): the EGP amounts for an Egypt order, the amounts in the
   * shopper's currency from `pricing.payIn` for an order shipped abroad (null = not shown).
   */
  readonly shopper: ShopperMoney;
  /**
   * The shipping fee in `payIn` was converted at the plain rate with no markup (`payIn.shippingFactor`,
   * orders from ATS-311 on), so in pounds it is its Egypt price.
   */
  readonly shippingAtPlainRate: boolean;
  /** Staff alert only: `orderStaffNotes.payInRate` (filled by the trigger), or null when not read or saved. */
  readonly staffRate: OrderEmailStaffRate | null;
}

/** `orderStaffNotes.payInRate` as the staff alert needs it, or null when missing or unreadable. */
export function readStaffRate(raw: unknown): OrderEmailStaffRate | null {
  if (!isRecord(raw)) return null;
  const markupPercent = raw['markupPercent'];
  const rate = raw['rate'];
  if (typeof markupPercent !== 'number' || !Number.isFinite(markupPercent) || markupPercent < 0) return null;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  return { markupPercent, rate };
}

/**
 * The order page link: `/checkout/confirmation/{orderId}`, plus `?key={viewKey}` for a guest order
 * so a shopper who isn't signed in can open it. Used by order emails and the Paymob return link.
 */
export function orderConfirmationUrl(storefrontUrl: string, orderId: string, viewKey: string | null): string {
  const base = `${storefrontUrl}/checkout/confirmation/${encodeURIComponent(orderId)}`;
  return viewKey ? `${base}?key=${encodeURIComponent(viewKey)}` : base;
}

/** The gift name of a free gift line, or null for a bought line. */
function readGiftName(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  return text(raw['giftName']) || 'Free gift';
}

/** The Buy X Get Y or bundle tag of a line ("Free", "1 free", "−50%", "Bundle price", "Bundle & Save"), or null. */
function readDealTag(raw: unknown, quantity: number): string | null {
  if (!Array.isArray(raw)) return null;
  const deals = raw
    .filter(isRecord)
    .map((deal) => ({
      units: wholeNumber(deal['units']),
      percent: wholeNumber(deal['percent']),
      bundle: deal['bundle'] === true,
      set: deal['set'] === true,
    }))
    .filter((deal) => deal.units > 0 && (deal.percent > 0 || deal.bundle));
  return dealTag(deals, quantity) || null;
}

/** `#` + first 6 characters of the order id in capitals. Keep in step with the Angular copy. */
export function shortOrderRef(orderId: string): string {
  return `#${orderId.slice(0, 6).toUpperCase()}`;
}

/** Returns null when the doc is not a store order emails can describe. */
export function readOrderForEmail(
  orderId: string,
  data: Readonly<Record<string, unknown>> | null | undefined,
): OrderEmailOrder | null {
  if (!data) return null;
  const paymentMethod = data['paymentMethod'];
  if (
    paymentMethod !== 'paymob' &&
    paymentMethod !== 'cash-on-delivery' &&
    paymentMethod !== 'instapay' &&
    paymentMethod !== 'bank-transfer'
  ) {
    return null;
  }
  const status = data['status'];
  if (
    status !== 'pending' &&
    status !== 'confirmed' &&
    status !== 'shipped' &&
    status !== 'delivered' &&
    status !== 'cancelled' &&
    status !== 'failed'
  ) {
    return null;
  }

  const pricing = isRecord(data['pricing']) ? data['pricing'] : null;
  if (!pricing) return null;
  const rawLines = Array.isArray(pricing['lines']) ? pricing['lines'] : [];
  const lines: Omit<OrderEmailLine, 'shopperAmount'>[] = [];
  // Index-matched to the saved lines (and so to `pricing.payIn.lines`), skipped ones included.
  const moneyLines: ShopperMoneyLine[] = [];
  const kept: number[] = [];
  for (const [index, raw] of rawLines.entries()) {
    if (!isRecord(raw)) {
      moneyLines.push({ lineEgp: 0, wasEgp: null });
      continue;
    }
    const productId = text(raw['productId']);
    const quantity = wholeNumber(raw['quantity']);
    if (!productId || quantity < 1) {
      moneyLines.push({ lineEgp: 0, wasEgp: null });
      continue;
    }
    const unitEgp = wholeNumber(raw['unitEgp']);
    const discountEgp = wholeNumber(raw['discountEgp']);
    // Pieces in a Buy X Get Y group pay the price before per-item offers: `fullEgp` is the line
    // before the discount. Older orders and other lines don't have it.
    const fullEgp = typeof raw['fullEgp'] === 'number' ? wholeNumber(raw['fullEgp']) : unitEgp * quantity;
    const lineEgp = Math.max(0, fullEgp - discountEgp);
    moneyLines.push({ lineEgp, wasEgp: discountEgp > 0 ? fullEgp : null });
    kept.push(index);
    lines.push({
      productId,
      name: text(raw['name']),
      optionLabels: readOptionLabels(raw['optionLabels']),
      imagePath: text(raw['imagePath']) || null,
      quantity,
      lineEgp,
      giftName: readGiftName(raw['gift']),
      dealTag: readDealTag(raw['deals'], quantity),
    });
  }
  if (lines.length === 0) return null;

  const subtotalEgp = wholeNumber(pricing['subtotalEgp']);
  const shipping = isRecord(pricing['shipping']) ? pricing['shipping'] : null;
  const shippingEgp = shipping ? wholeNumber(shipping['priceEgp']) : 0;
  const storedTotal = pricing['totalEgp'];
  const totalEgp =
    typeof storedTotal === 'number' && Number.isFinite(storedTotal)
      ? wholeNumber(storedTotal)
      : subtotalEgp + shippingEgp;

  const shippingCountry = text(isRecord(data['shipping']) ? data['shipping']['country'] : undefined);
  // Same test as the order page (`orderShopperMoney`): shipped outside Egypt.
  const isInternational =
    pricing['isInternational'] === true || (shippingCountry !== '' && shippingCountry !== 'EG');
  // Paid from abroad for delivery to someone in Egypt: amounts in the shopper's currency too.
  const paidFromCountry =
    typeof pricing['paidFromCountry'] === 'string' && pricing['paidFromCountry'] !== 'EG'
      ? pricing['paidFromCountry']
      : null;
  const paysInOtherCurrency = isInternational || paidFromCountry !== null;
  const payIn = isRecord(pricing['payIn']) ? pricing['payIn'] : null;
  const shopper = shopperMoney({
    abroad: paysInOtherCurrency,
    lines: moneyLines,
    subtotalEgp,
    shippingEgp,
    totalEgp,
    payIn: payIn
      ? {
          currency: text(payIn['currency']),
          amount: finiteNumber(payIn['amount']),
          lines: Array.isArray(payIn['lines']) ? payIn['lines'].map(finiteNumber) : undefined,
          shipping: typeof payIn['shipping'] === 'number' ? finiteNumber(payIn['shipping']) : undefined,
          factor: typeof payIn['factor'] === 'number' ? finiteNumber(payIn['factor']) : undefined,
        }
      : null,
  });

  const shippingAddress = isRecord(data['shipping']) ? data['shipping'] : {};
  const email = text(data['customerEmail']);

  return {
    id: orderId,
    ref: shortOrderRef(orderId),
    status,
    paymentMethod,
    customerEmail: email.includes('@') ? email : null,
    isInternational,
    paysInOtherCurrency,
    paidFromCountry,
    payer: payerOf(data['payer'], paidFromCountry),
    address: {
      fullName: text(shippingAddress['fullName']),
      line1: text(shippingAddress['line1']),
      line2: text(shippingAddress['line2']) || null,
      city: text(shippingAddress['city']),
      region: text(shippingAddress['region']) || null,
      postalCode: text(shippingAddress['postalCode']),
      country: text(shippingAddress['country']),
      phone: text(shippingAddress['phone']),
    },
    lines: lines.map((line, at) => ({ ...line, shopperAmount: shopper.lines[kept[at]!] ?? null })),
    subtotalEgp,
    shippingEgp,
    totalEgp,
    needsReview: data['needsReview'] === true,
    feeToBeAgreed: isDeliveryFeeToBeAgreed(shipping),
    deliveryFeeAgreed:
      (shipping?.['kind'] === 'domestic-agreed' || shipping?.['kind'] === 'international-agreed') &&
      shipping['feeAgreed'] === true,
    deliveryFeeSetAtMs: timestampMs(data['deliveryFeeSetAt']),
    shippedAtMs: timestampMs(data['shippedAt']),
    deliveredAtMs: timestampMs(data['deliveredAt']),
    reopenedAtMs: timestampMs(data['reopenedAt']),
    viewKey: text(data['viewKey']) || null,
    payIn: readPayIn(pricing['payIn']),
    chargeEgp:
      typeof pricing['chargeEgp'] === 'number' &&
      Number.isFinite(pricing['chargeEgp']) &&
      pricing['chargeEgp'] > 0
        ? wholeNumber(pricing['chargeEgp'])
        : null,
    createdAtMs: timestampMs(data['createdAt']),
    guestCheckout: !text(data['customerId']),
    boxId: (shipping && text(shipping['boxId'])) || null,
    shopper,
    shippingAtPlainRate:
      payIn !== null && typeof payIn['shippingFactor'] === 'number' && payIn['shippingFactor'] > 0,
    staffRate: null,
  };
}

/** Firestore Timestamp (or Date / epoch ms) → epoch ms, else null. */
function timestampMs(raw: unknown): number | null {
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (isRecord(raw) && typeof raw['toMillis'] === 'function') {
    const ms = (raw as { toMillis: () => unknown }).toMillis();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function readOptionLabels(raw: unknown): { label: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { label: string; value: string }[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const label = text(entry['label']);
    const value = text(entry['value']);
    if (label && value) out.push({ label, value });
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A finite number, or NaN (which the shopper amounts treat as unreadable). */
function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function wholeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The saved `payer` of an order paid from abroad, or null (missing, unreadable, or not paid from abroad). */
function payerOf(raw: unknown, paidFromCountry: string | null): OrderEmailPayer | null {
  if (!paidFromCountry || !isRecord(raw)) return null;
  const fullName = text(raw['fullName']);
  const phone = text(raw['phone']);
  if (!fullName && !phone) return null;
  return { fullName, phone, country: text(raw['country']) || paidFromCountry };
}
