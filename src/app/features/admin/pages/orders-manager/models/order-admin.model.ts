import type { OrderStage } from '@core/config/order-messages';
import type { ReopenStatus, StaffOrderStatus } from '@core/config/order-status';
import type { OrderDoc } from '@core/services/orders/order.schema';

export type OrderStatusFilter = OrderDoc['status'] | 'all';

/** What the Orders list asks Firestore for. */
export interface OrderListQuery {
  readonly status: OrderStatusFilter;
  /** One search word (the longest typed); the others are checked in the browser. */
  readonly term: string | null;
  /** Placed from `start` up to (not including) `end`. */
  readonly placed: { readonly start: Date; readonly end: Date } | null;
}

/** One choice in the status dropdown. */
export interface OrderStatusMove {
  readonly status: StaffOrderStatus;
  /** "Shipped", or "Back to Confirmed" for a step back. */
  readonly label: string;
  /**
   * Confirmed, Shipped or Delivered: the shopper gets an email about it (only the first time the
   * order gets there; the email is never sent twice).
   */
  readonly emailsShopper: boolean;
}

/** Reopen Order on a cancelled order (ATS-325): where it goes back to. */
export interface OrderReopen {
  /** The status before the cancel. */
  readonly status: ReopenStatus;
  /** Back to Confirmed: the items come out of stock again. */
  readonly takesStock: boolean;
}

/** One saved status change, ready to show. */
export interface OrderHistoryEntry {
  readonly label: string;
  readonly when: string;
  /** Staff email, else uid. */
  readonly by: string;
  readonly reason: string | null;
}

export type OrderLineStockStatus = 'in' | 'out' | 'unset' | 'missing';

/** Lean product fields needed to show live stock beside an order line. */
export interface ProductStockLookup {
  readonly id: string;
  readonly name: string;
  readonly stock?: number;
  readonly stockBySize?: Readonly<Record<string, number>>;
  readonly options: readonly {
    readonly key: string;
    readonly label: string;
    readonly values: readonly { readonly id: string; readonly label: string }[];
  }[];
}

export interface OrderLineAdminRow {
  readonly id: string;
  readonly orderId: string;
  /** `#A1B2C3`, the number shoppers see in emails and on the confirmation page. */
  readonly orderRef: string;
  readonly placedAtLabel: string;
  /** When the order last changed (status, fee, payment), e.g. `11/11/2026, 2:14:00 PM`. */
  readonly updatedAtLabel: string;
  readonly customerName: string;
  readonly country: string;
  readonly status: OrderDoc['status'];
  readonly paymentMethod: OrderDoc['paymentMethod'];
  readonly paymentLabel: string;
  readonly productId: string;
  readonly productName: string;
  /** Free gift line (price 0, listed after its item): the gift's name, e.g. "Free shirt". */
  readonly giftName: string | null;
  /** Buy X Get Y discount on the line, e.g. "Free", "1 free" or "−50%"; null when none. */
  readonly dealLabel: string | null;
  readonly selectionLabel: string;
  readonly quantity: number;
  readonly currentStock: number | null;
  readonly stockStatus: OrderLineStockStatus;
  readonly orderTotalLabel: string;
  /** Bank Transfer from abroad in another currency: the same order in Egypt, `EGP 4,747 in Egypt`. */
  readonly egyptTotalLabel: string | null;
  /** Bank Transfer from abroad in another currency: `Abroad · QAR`. */
  readonly abroadTag: string | null;
  /** Shopper phone as typed at checkout. */
  readonly phone: string;
  /** What the order may say right now (`orderStage()`). */
  readonly stage: OrderStage;
  /** True on the first line of each order: order actions show there only. */
  readonly isFirstLine: boolean;
  /** WhatsApp chat with the shopper, message already written for this stage. Null = copy the number instead. */
  readonly whatsappUrl: string | null;
  /** Pending InstaPay: Confirmed asks staff to check the bank app first. */
  readonly confirmAction: 'confirm-order' | 'confirm-payment' | null;
  /** The status dropdown: only the moves allowed from the current status (empty = no dropdown). */
  readonly statusMoves: readonly OrderStatusMove[];
  /** Cancelled within 7 days (not Card, not Payment Failed): Reopen Order shows; else null. */
  readonly reopen: OrderReopen | null;
  /** Items are out of stock for this order right now (a cancel puts them back). */
  readonly stockTaken: boolean;
  /** Every status change, oldest first (staff-only). */
  readonly history: readonly OrderHistoryEntry[];
  /** Staff-only note saved when the order was cancelled. */
  readonly cancelReason: string | null;
  /**
   * Large Egypt order: `set` while the delivery fee is still to be agreed, `change` once saved
   * and the order is still open. Null for every other order.
   */
  readonly deliveryFeeAction: 'set' | 'change' | null;
  /** Delivery fee saved on the order in whole EGP (for the Change dialog). */
  readonly deliveryFeeEgp: number | null;
  /** Money staff should see arrive before confirming, e.g. `EGP 1,500`. Null when nothing is due. */
  readonly amountDueLabel: string | null;
}

/** One order on the Orders page: its first row carries the order actions, `lines` are the items. */
export interface OrderCard {
  readonly orderId: string;
  readonly first: OrderLineAdminRow;
  readonly lines: readonly OrderLineAdminRow[];
  /** The full order for the opened row (customer, address, payment, items and money). */
  readonly details: OrderDetails | null;
}

/** One label / value line in a details box ("Subtotal" · "EGP 5,000"). */
export interface OrderDetailRow {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
  /** Grey, e.g. "Same order in Egypt". */
  readonly muted?: boolean;
}

/**
 * One price shown three ways on an order from abroad (ATS-304): what the customer pays in their
 * currency, what that comes to in pounds (null: rate unknown, the column is hidden) and the price
 * in Egypt. All three read "Free" on a free line or free shipping.
 */
export interface AbroadPriceCells {
  readonly customer: string;
  readonly pounds: string | null;
  readonly egypt: string;
  /** "+408 abroad" under the Egypt price; null when abroad prices add nothing. */
  readonly extra: string | null;
}

/** An order from abroad's Subtotal, Shipping or Total row in the three columns. */
export interface AbroadTotalRow extends AbroadPriceCells {
  readonly label: string;
  readonly strong?: boolean;
}

/** The three-price view of a Bank Transfer order from abroad (orders that saved line amounts). */
export interface AbroadOrderView {
  /** False when the rate is unknown: the In pounds column is left out. */
  readonly showPounds: boolean;
  readonly totals: readonly AbroadTotalRow[];
  /** The grey box under the totals; null when the rate is unknown. */
  readonly note: {
    readonly extra: string;
    /** "Abroad prices +40% · rate on the day 1 QAR = 14.66 EGP"; null when not saved. */
    readonly rate: string | null;
  } | null;
}

/** One saved order line as staff see it. */
export interface OrderDetailItem {
  readonly key: string;
  readonly productId: string;
  /** False when the product doc is gone: no link to the product form. */
  readonly productExists: boolean;
  readonly name: string;
  /** "Size: M · Colour: Black", empty when the item has no options. */
  readonly options: string;
  readonly imagePath: string | null;
  readonly imageSrc: string;
  readonly quantity: number;
  /** Free gift line: the gift's name. */
  readonly gift: string | null;
  /** Buy X Get Y tag ("1 free", "−50%"). */
  readonly deal: string | null;
  /** Order from abroad: the line in three columns (the struck-out `was` is then in the customer's currency). */
  readonly abroad: AbroadPriceCells | null;
  /** "EGP 350 × 3"; null on a gift. */
  readonly unit: string | null;
  /** Line price after offers, or "Free". */
  readonly price: string;
  /** Line price before a Buy X Get Y discount; null when none. */
  readonly was: string | null;
  /** "3 left", "1 left · Low", "Product removed". */
  readonly stock: string;
  readonly stockStatus: OrderLineStockStatus;
}

/** Everything about one order for the opened row and the order page. */
export interface OrderDetails {
  readonly stage: OrderStage;
  /** What staff do next ("Check that EGP 4,915 arrived …"); null when nothing waits on them. */
  readonly nextStep: string | null;
  readonly customer: {
    readonly name: string;
    readonly email: string | null;
    readonly phone: string;
    readonly account: 'Has an account' | 'Guest';
  };
  /** "Cairo", or "Dubai, United Arab Emirates" abroad. */
  readonly city: string;
  readonly address: { readonly lines: readonly string[]; readonly copyText: string };
  /** "Box 2", "Box 1 (abroad)", "Large order · fee to be agreed". */
  readonly shippingBox: string | null;
  /** "Delivery to be confirmed · Brazil" while an order abroad waits for its fee (ATS-314), else null. */
  readonly deliveryToConfirm: string | null;
  readonly payment: { readonly method: string; readonly rows: readonly OrderDetailRow[] };
  readonly items: readonly OrderDetailItem[];
  /** Up to 2 items with a photo, for the list row (one on a phone). */
  readonly thumbs: readonly OrderDetailItem[];
  /** "3 items" (pieces, gifts left out). */
  readonly pieces: string;
  /** Subtotal and Shipping, in the currency the customer saw. */
  readonly totals: readonly OrderDetailRow[];
  readonly total: string;
  /** The total in EGP when the customer saw another currency. */
  readonly totalEgp: string | null;
  /** Bank Transfer from abroad with saved line amounts: the three-price view; null otherwise. */
  readonly abroad: AbroadOrderView | null;
  /** Paid while an item had sold out. */
  readonly needsReview: boolean;
  /** "11 Nov, 2:14 pm". */
  readonly placedShort: string;
}
