import type { GiftPick, GiftView } from '../../utils/product-gifts';

/** What the gift panel is opened with. */
export interface GiftPickerData {
  readonly gift: GiftView;
  /** "Your free shirt". */
  readonly title: string;
  /** "Free gift · 1 of 2". */
  readonly step: string;
  /** What is picked for this gift so far, or null. */
  readonly pick: GiftPick | null;
  /** The next gift row that still needs a pick ("Your free socks"), or null when this is the last one. */
  readonly next: string | null;
}

/** What the gift panel hands back: the product (and size) picked, and whether to go to the next gift. */
export interface GiftPickerResult {
  readonly productId: string;
  readonly sizeId: string | null;
  readonly next: boolean;
}
