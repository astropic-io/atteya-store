import type { GiftChoiceView } from '@core/services/cart/cart-gifts';

/** What is picked for a row so far: a product and, when it has sizes, its size. */
export interface ChoicePick {
  readonly productId: string;
  readonly sizeId: string | null;
}

/** What the choice panel is opened with (a free gift, a Bundle price piece or a Bundle & Save piece). */
export interface ChoicePickerData {
  readonly choices: readonly GiftChoiceView[];
  /** "Your free shirt", "Piece 2", "Your racket". */
  readonly title: string;
  /** "Free gift · 1 of 2", "Bundle price · 2 of 3". */
  readonly step: string;
  /** What is picked for this row so far, or null. */
  readonly pick: ChoicePick | null;
  /** The next row that still needs a pick ("Your free socks"), or null when this is the last one. */
  readonly next: string | null;
  /** The hint while nothing is picked ("Tap a photo to pick your free gift."). */
  readonly hint: string;
}

/** What the panel hands back: the product (and size) picked, and whether to go to the next row. */
export interface ChoicePickerResult {
  readonly productId: string;
  readonly sizeId: string | null;
  readonly next: boolean;
}
