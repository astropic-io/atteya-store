import { shopperMoney, type ShopperMoney } from '@core/services/offers/engine';
import { formatMoney } from '@shared/utils/money';
import type { OrderDoc } from './order.schema';

/**
 * What the shopper sees for a saved order (order page, Account → Orders; ATS-309): EGP for an
 * Egypt order, and only the currency they pay in for an order shipped abroad (`pricing.payIn`),
 * never EGP or the Egypt price. Staff pages keep EGP and never use this.
 */
export function orderShopperMoney(pricing: OrderDoc['pricing']): ShopperMoney {
  return shopperMoney({
    abroad: pricing.isInternational || pricing.shippingCountry !== 'EG',
    lines: pricing.lines.map((line) => ({
      lineEgp: line.lineDisplay,
      wasEgp: (line.discountEgp ?? 0) > 0 ? (line.fullEgp ?? line.unitDisplay * line.quantity) : null,
    })),
    subtotalEgp: pricing.subtotalDisplay,
    shippingEgp: pricing.shipping?.priceDisplay ?? 0,
    totalEgp: pricing.totalDisplay,
    payIn: pricing.payIn,
  });
}

/** One shopper amount as text ("QAR 78", "EGP 865"), or null when there is none to show. */
export function formatShopperAmount(money: ShopperMoney, amount: number | null): string | null {
  return amount === null ? null : formatMoney(amount, money.currency, money.decimals);
}
