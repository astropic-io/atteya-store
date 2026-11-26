import {
  isDeliveryFeeToBeAgreed,
  orderStage,
  paymentDue,
  type OrderStage,
} from '@core/config/order-messages';
import { canCancelItems, readItemCancels } from '@core/config/order-item-cancel';
import { dealTag, displayDecimals } from '@core/services/offers/engine';
import { orderMessageInput } from '@core/services/orders/order-message-input';
import type { OrderDoc, OrderStaffNotes } from '@core/services/orders/order.schema';
import { orderDate } from '@core/services/orders/shopper-orders.service';
import { normalizeImageKitPath } from '@shared/utils/image';
import { formatMoney } from '@shared/utils/money';
import type {
  AbroadOrderView,
  AbroadPriceCells,
  AbroadTotalRow,
  OrderCancelledItem,
  OrderDetailItem,
  OrderDetailRow,
  OrderDetails,
  ProductStockLookup,
} from '../models/order-admin.model';
import {
  abroadExtra,
  abroadPrices,
  abroadRateLine,
  customerMoney,
  customerUnit,
  customerWas,
  inPounds,
  type AbroadPrices,
} from './abroad-prices.utils';
import { currentStockForLine, paymentLabel, selectionLabel } from './order-admin.utils';

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "11 Nov, 2:14 pm", or empty when the saved date is unreadable. */
export function shortOrderDate(raw: unknown): string {
  const date = orderDate(raw);
  return date ? SHORT_DATE.format(date) : '';
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Box 2", "Box 1 (abroad)", "Delivery fee to be agreed". */
function shippingLabel(order: OrderDoc): string | null {
  const line = order.pricing.shipping;
  if (!line) return null;
  if (line.kind === 'domestic-agreed') {
    return line.feeAgreed ? 'Large order · fee agreed' : 'Large order · fee to be agreed';
  }
  if (line.kind === 'international-agreed') {
    return line.feeAgreed ? 'Abroad · fee agreed' : deliveryToConfirm(order);
  }
  const box = line.boxId ? `Box ${line.boxId.replace(/\D/g, '') || line.boxId}` : null;
  if (line.kind === 'international-box') return box ? `${box} (abroad)` : 'Abroad';
  return box;
}

/** "Delivery to be confirmed · Brazil": an order abroad whose delivery is agreed on WhatsApp (ATS-314). */
export function deliveryToConfirm(order: OrderDoc): string {
  return `Delivery to be confirmed · ${countryName(order.shipping.country)}`;
}

/** What staff should do next, from the order's stage. Null when nothing is waiting on them. */
function nextStep(stage: OrderStage, order: OrderDoc, money: (egp: number) => string): string | null {
  const due = paymentDue(stage, orderMessageInput(order));
  const amount = due?.amountEgp != null ? money(due.amountEgp) : 'the amount';
  switch (stage) {
    case 'fee-to-be-agreed':
      return order.shipping.country !== 'EG'
        ? `Check that we can deliver to ${countryName(order.shipping.country)}, agree the shipping fee with the customer on WhatsApp, then use Set Delivery Fee.`
        : 'Agree the delivery fee with the customer on WhatsApp, then use Set Delivery Fee.';
    case 'instapay-total-due':
      return `Check that ${amount} arrived in your bank app, then change the status to Confirmed.`;
    case 'instapay-fee-due':
      return `Check that the delivery fee of ${amount} arrived by InstaPay, then change the status to Confirmed.`;
    case 'bank-transfer-due': {
      const payIn = due?.payIn;
      const sent = payIn
        ? formatMoney(payIn.amount, payIn.currency, displayDecimals(payIn.currency))
        : 'the transfer';
      return `Check that ${sent} arrived in your bank account, then change the status to Confirmed.`;
    }
    case 'cod-free-pending':
      return 'Confirm the order with the customer on WhatsApp, then change the status to Confirmed.';
    case 'paid-needs-review':
      return 'Paid while an item had sold out. Check the stock and message the customer before you ship.';
    case 'paid':
    case 'cod-confirmed':
      return 'Pack the order and send it, then change the status to Shipped.';
    case 'shipped':
      return 'Change the status to Delivered once the customer has the order.';
    default:
      return null;
  }
}

const egpMoney = (amount: number) => formatMoney(amount, 'EGP', 0);

/** One price three ways: customer's currency, pounds (null: rate unknown) and Egypt; "Free" at 0. */
function abroadCells(prices: AbroadPrices, customer: number, egypt: number, free: boolean): AbroadPriceCells {
  if (free) {
    return {
      customer: 'Free',
      pounds: prices.egpPerUnit === null ? null : 'Free',
      egypt: 'Free',
      extra: null,
    };
  }
  const pounds = inPounds(prices, customer);
  return {
    customer: customerMoney(prices, customer),
    pounds: pounds === null ? null : egpMoney(pounds),
    egypt: egpMoney(egypt),
    extra: abroadExtra(pounds, egypt),
  };
}

/**
 * The shipping row of an order from abroad. Shipping abroad has no markup (ATS-311): in pounds it is
 * its Egypt price, with no "+N abroad". Older orders, whose shipping had the markup, keep the old look.
 */
function abroadShippingCells(prices: AbroadPrices, customer: number, egypt: number): AbroadPriceCells {
  const cells = abroadCells(prices, customer, egypt, egypt === 0);
  if (!prices.shippingAtPlainRate || egypt === 0 || cells.pounds === null) return cells;
  return { ...cells, pounds: egpMoney(egypt), extra: null };
}

/** Subtotal, Shipping and Total of an order from abroad in three columns, and the grey note under them. */
function abroadView(order: OrderDoc, prices: AbroadPrices): AbroadOrderView | null {
  const lines = prices.lines;
  const shippingAmount = prices.shipping;
  if (!lines || shippingAmount === null) return null;
  const pricing = order.pricing;
  const subtotal = Number(lines.reduce((sum, value) => sum + value, 0).toFixed(prices.decimals));
  const shippingLabelText = shippingLabel(order);
  const totals: AbroadTotalRow[] = [
    { label: 'Subtotal', ...abroadCells(prices, subtotal, pricing.subtotalDisplay, false) },
  ];
  if (pricing.shipping && isDeliveryFeeToBeAgreed(pricing.shipping)) {
    // Delivery to be confirmed abroad (ATS-314): no fee yet in any column.
    const later = 'To be agreed';
    totals.push({
      label: shippingLabelText ? `Shipping · ${shippingLabelText}` : 'Shipping',
      customer: later,
      pounds: prices.egpPerUnit === null ? null : later,
      egypt: later,
      extra: null,
    });
  } else if (pricing.shipping) {
    totals.push({
      label: shippingLabelText ? `Shipping · ${shippingLabelText}` : 'Shipping',
      ...abroadShippingCells(prices, shippingAmount, pricing.shipping.priceEgp),
    });
  }
  // Card abroad (ATS-311): in pounds the total is exactly what Paymob charges.
  const cardEgp = 'paymob' in order && order.paymob ? order.paymob.amountCents / 100 : null;
  const totalCells = abroadCells(prices, prices.amount, prices.egyptTotal, false);
  totals.push({
    label: 'Total',
    strong: true,
    ...(cardEgp === null || totalCells.pounds === null
      ? totalCells
      : { ...totalCells, pounds: egpMoney(cardEgp), extra: abroadExtra(cardEgp, prices.egyptTotal) }),
  });
  const poundsTotal =
    cardEgp !== null && prices.egpPerUnit !== null ? cardEgp : inPounds(prices, prices.amount);
  return {
    showPounds: prices.egpPerUnit !== null,
    totals,
    note:
      poundsTotal === null
        ? null
        : {
            extra:
              poundsTotal > prices.egyptTotal ? `+${egpMoney(poundsTotal - prices.egyptTotal)}` : egpMoney(0),
            rate: abroadRateLine(prices),
          },
  };
}

/** Every saved line as staff see it: photo, options, offer, prices and live stock. */
function detailItems(
  order: OrderDoc,
  productsById: ReadonlyMap<string, ProductStockLookup>,
  money: (amount: number) => string,
  abroad: AbroadPrices | null,
): OrderDetailItem[] {
  const cancellable = canCancelItems(order);
  return order.pricing.lines.map((line, index) => {
    const product = productsById.get(line.productId) ?? null;
    const selection = line.selection ?? {};
    const stock = currentStockForLine(product, selection);
    const imagePath = line.imagePath?.trim() || null;
    const options = line.optionLabels?.length
      ? line.optionLabels.map((opt) => `${opt.label}: ${opt.value}`).join(' · ')
      : Object.keys(selection).length
        ? selectionLabel(product, selection)
        : '';
    const gift = line.gift ? line.gift.giftName || 'Free gift' : null;
    const discounted = (line.discountEgp ?? 0) > 0 && !gift;
    const free = !!gift || line.lineDisplay === 0;
    const base = {
      key: `${index}:${line.productId}`,
      lineIndex: index,
      cancellable: cancellable && !line.gift,
      productId: line.productId,
      productExists: product !== null,
      name: line.name || product?.name || 'Product unavailable',
      options,
      imagePath,
      imageSrc: imagePath ? normalizeImageKitPath(imagePath) : '',
      quantity: line.quantity,
      gift,
      deal: line.deals?.length ? dealTag(line.deals, line.quantity) || null : null,
      stock:
        stock.status === 'missing'
          ? 'Product removed'
          : stock.count === null
            ? 'Stock not set'
            : `${stock.count} left${stock.count > 0 && stock.count <= 2 ? ' · Low' : ''}`,
      stockStatus: stock.status,
    };

    // Order from abroad: prices in the customer's currency, in pounds and at the Egypt price.
    const customerLine = abroad?.lines?.[index];
    if (abroad && customerLine !== undefined) {
      // A Buy X Get Y group line is converted as a whole, so a converted unit × quantity wouldn't match it.
      const unit = gift || line.fullEgp !== undefined ? null : customerUnit(abroad, line.unitEgp);
      const was = discounted ? customerWas(abroad, line) : null;
      return {
        ...base,
        abroad: abroadCells(abroad, customerLine, line.lineDisplay, free),
        unit: unit === null ? null : `${customerMoney(abroad, unit)} × ${line.quantity}`,
        price: free ? 'Free' : customerMoney(abroad, customerLine),
        was: was === null ? null : customerMoney(abroad, was),
      };
    }
    return {
      ...base,
      abroad: null,
      unit: gift ? null : `${money(line.unitDisplay)} × ${line.quantity}`,
      price: free ? 'Free' : money(line.lineDisplay),
      was: discounted ? money(line.fullEgp ?? line.unitDisplay * line.quantity) : null,
    };
  });
}

/** The pieces staff cancelled (ATS-342), with who, why and the refund state. */
function cancelledItems(order: OrderDoc, notes: OrderStaffNotes | null): OrderCancelledItem[] {
  return readItemCancels(order.itemCancels).map((entry) => {
    const note = notes?.itemCancels.find((n) => n.id === entry.id) ?? null;
    const imagePath = entry.item.imagePath?.trim() || null;
    const giftPieces = entry.gifts.reduce((sum, g) => sum + g.quantity, 0);
    const meta = [
      entry.atMs ? SHORT_DATE.format(new Date(entry.atMs)) : '',
      note?.byEmail || note?.by || '',
      note?.reason?.trim() ? `"${note.reason.trim()}"` : '',
    ].filter(Boolean);
    const toSend = entry.refundEgp > 0 && entry.refundSentAtMs === null ? entry.refundEgp : 0;
    let refund: string | null = null;
    if (entry.refundEgp > 0) {
      refund =
        entry.refundSentAtMs !== null
          ? `Refund ${egpMoney(entry.refundSentEgp ?? entry.refundEgp)} sent ${SHORT_DATE.format(new Date(entry.refundSentAtMs))}`
          : `Refund ${egpMoney(entry.refundEgp)}${entry.refundTo ? ` · to ${entry.refundTo}` : ''}`;
    }
    return {
      id: entry.id,
      name: entry.item.name || 'Item',
      options: entry.item.optionLabels.map((o) => `${o.label}: ${o.value}`).join(' · '),
      imagePath,
      imageSrc: imagePath ? normalizeImageKitPath(imagePath) : '',
      quantity: entry.item.quantity,
      gifts: giftPieces > 0 ? `+ ${giftPieces} free ${giftPieces === 1 ? 'gift' : 'gifts'}` : null,
      stock: entry.stockReturned ? 'Back in stock' : 'Nothing was taken out of stock',
      meta: `Cancelled ${meta.join(' · ')}`.trim(),
      amountOff: entry.amountOffEgp > 0 ? `−${egpMoney(entry.amountOffEgp)}` : egpMoney(0),
      refundToSendEgp: toSend,
      refund,
    };
  });
}

/** Under Total once items were cancelled: the first total, and what is still to send back. */
function afterTotalRows(order: OrderDoc, cancelled: readonly OrderCancelledItem[]): OrderDetailRow[] {
  const entries = readItemCancels(order.itemCancels);
  const first = entries[0];
  if (!first) return [];
  const rows: OrderDetailRow[] = [{ label: 'Was', value: egpMoney(first.totalBeforeEgp), muted: true }];
  const toSend = cancelled.reduce((sum, c) => sum + c.refundToSendEgp, 0);
  if (toSend > 0) rows.push({ label: 'Refund to send', value: egpMoney(toSend), strong: true });
  return rows;
}

/** Order from abroad (with saved line amounts): what the transfer comes to in pounds, and in Egypt. */
function abroadPaymentRows(abroad: AbroadPrices | null): OrderDetailRow[] {
  if (!abroad?.lines) return [];
  const rows: OrderDetailRow[] = [];
  const pounds = inPounds(abroad, abroad.amount);
  if (pounds !== null) {
    rows.push({ label: 'Comes to in pounds', value: `about ${egpMoney(pounds)}`, strong: true });
  }
  rows.push({ label: 'Same order in Egypt', value: egpMoney(abroad.egyptTotal), muted: true });
  return rows;
}

/** Payment rows: what to receive, what came in, and the Card / Bank Transfer details. */
function paymentRows(
  order: OrderDoc,
  stage: OrderStage,
  egp: (amount: number) => string,
  abroad: AbroadPrices | null,
): OrderDetailRow[] {
  const rows: OrderDetailRow[] = [];
  const pricing = order.pricing;
  const due = paymentDue(stage, orderMessageInput(order));
  if (due) {
    if (due.reason === 'bank-transfer' && due.payIn) {
      rows.push({
        label: 'To receive by bank transfer',
        value: formatMoney(due.payIn.amount, due.payIn.currency, displayDecimals(due.payIn.currency)),
        strong: true,
      });
      rows.push(...abroadPaymentRows(abroad));
    } else if (due.amountEgp != null) {
      rows.push({
        label: due.reason === 'shipping-fee' ? 'Delivery fee by InstaPay' : 'To receive by InstaPay',
        value: egp(due.amountEgp),
        strong: true,
      });
    }
    rows.push({ label: 'Received', value: 'Not yet' });
  } else if (stage === 'fee-to-be-agreed' && order.paymentMethod === 'bank-transfer') {
    // Nothing is due or sent until the delivery fee is agreed (ATS-319): the saved amount is items only.
    rows.push({ label: 'To receive by bank transfer', value: 'After the fee is agreed', strong: true });
    if (abroad?.lines) {
      rows.push({ label: 'Same order in Egypt', value: egpMoney(abroad.egyptTotal), muted: true });
    }
    rows.push({ label: 'Received', value: 'Not yet' });
  } else if (pricing.payIn && order.paymentMethod === 'bank-transfer') {
    rows.push({
      label: 'Customer sent',
      value: formatMoney(
        pricing.payIn.amount,
        pricing.payIn.currency,
        displayDecimals(pricing.payIn.currency),
      ),
    });
    rows.push(...abroadPaymentRows(abroad));
  }

  if (
    order.paymentMethod === 'cash-on-delivery' &&
    order.status !== 'cancelled' &&
    order.status !== 'failed' &&
    pricing.shipping &&
    typeof pricing.totalEgp === 'number'
  ) {
    const cash = pricing.totalEgp - pricing.shipping.priceEgp;
    if (cash > 0) rows.push({ label: 'Cash at the door', value: egp(cash) });
  }

  if ('paymob' in order && order.paymob) {
    const paid = shortOrderDate(order.paymob.paidAt);
    if (abroad) {
      // Card abroad (ATS-311): Paymob charges pounds, the customer's total at the plain rate.
      const label = order.paymob.paidAt ? 'Charged by card' : 'To charge by card';
      rows.push({ label, value: egp(order.paymob.amountCents / 100), strong: true });
      rows.push({ label: 'Same order in Egypt', value: egpMoney(abroad.egyptTotal), muted: true });
    }
    rows.push({ label: 'Card payment', value: paid ? `Paid ${paid}` : 'Not paid yet' });
    if (order.paymob.transactionId != null) {
      rows.push({ label: 'Card transaction number', value: String(order.paymob.transactionId) });
    }
  }

  if (pricing.currency !== 'EGP') {
    rows.push({ label: 'Customer saw prices in', value: pricing.currency });
  }
  return rows;
}

/** Everything staff need about one order, built from the saved order (and live stock). */
export function orderDetails(
  order: OrderDoc,
  productsById: ReadonlyMap<string, ProductStockLookup>,
  notes: OrderStaffNotes | null = null,
): OrderDetails {
  const pricing = order.pricing;
  const decimals = displayDecimals(pricing.currency);
  const money = (amount: number) => formatMoney(amount, pricing.currency, decimals);
  const egp = (amount: number) => formatMoney(amount, 'EGP', 0);
  const stage = orderStage(orderMessageInput(order));
  const shipping = order.shipping;
  const payer = order.payer ?? null;
  const feeToBeAgreed = isDeliveryFeeToBeAgreed(pricing.shipping);

  const cityLine = [shipping.city, shipping.region].filter(Boolean).join(', ');
  const addressLines = [
    shipping.line1,
    shipping.line2,
    [cityLine, shipping.postalCode].filter(Boolean).join(' '),
    countryName(shipping.country),
  ].filter((part): part is string => !!part && part.trim() !== '');

  const prices = abroadPrices(order, notes?.payInRate ?? null);
  const items = detailItems(order, productsById, money, prices);
  const pieces = pricing.lines.filter((line) => !line.gift).reduce((sum, line) => sum + line.quantity, 0);

  const totals: OrderDetailRow[] = [
    { label: 'Subtotal', value: money(pricing.subtotalDisplay) },
    {
      label: shippingLabel(order) ? `Shipping · ${shippingLabel(order)}` : 'Shipping',
      value: !pricing.shipping
        ? '—'
        : feeToBeAgreed
          ? 'To be agreed'
          : pricing.shipping.priceDisplay === 0
            ? 'Free'
            : money(pricing.shipping.priceDisplay),
    },
  ];
  const total = feeToBeAgreed ? `${money(pricing.totalDisplay)} + shipping` : money(pricing.totalDisplay);
  const totalEgp =
    pricing.currency !== 'EGP' && typeof pricing.totalEgp === 'number' ? egp(pricing.totalEgp) : null;

  const cancelled = cancelledItems(order, notes);
  const refundToSend = cancelled.reduce((sum, c) => sum + c.refundToSendEgp, 0);
  const step = nextStep(stage, order, egp);

  return {
    stage,
    nextStep:
      refundToSend > 0
        ? `Send the customer ${egp(refundToSend)} back by InstaPay, then press Refund Sent on the cancelled item.${step ? ` ${step}` : ''}`
        : step,
    // Paid from abroad for delivery in Egypt: the customer is the payer, the address the recipient's.
    customer: {
      name: payer?.fullName ?? shipping.fullName,
      email: order.customerEmail?.trim() || null,
      phone: payer?.phone ?? shipping.phone,
      account: order.customerId ? 'Has an account' : 'Guest',
      paysFrom: payer ? `Pays from ${countryName(payer.country)}` : null,
    },
    recipient: payer ? { name: shipping.fullName, phone: shipping.phone } : null,
    city: shipping.country === 'EG' ? shipping.city : `${shipping.city}, ${countryName(shipping.country)}`,
    address: {
      lines: addressLines,
      copyText: [shipping.fullName, ...addressLines, shipping.phone].join('\n'),
    },
    shippingBox: shippingLabel(order),
    deliveryToConfirm:
      pricing.shipping?.kind === 'international-agreed' && feeToBeAgreed ? deliveryToConfirm(order) : null,
    payment: {
      method: paymentLabel(order),
      rows: paymentRows(order, stage, egp, prices),
    },
    items,
    thumbs: items.filter((item) => item.imagePath).slice(0, 2),
    pieces: `${pieces} ${pieces === 1 ? 'item' : 'items'}`,
    totals,
    total,
    totalEgp,
    cancelled,
    afterTotal: afterTotalRows(order, cancelled),
    abroad: prices ? abroadView(order, prices) : null,
    needsReview: 'needsReview' in order && order.needsReview === true,
    placedShort: shortOrderDate(order.createdAt),
  };
}
