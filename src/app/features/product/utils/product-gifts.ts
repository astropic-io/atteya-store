import type { GiftChoiceView } from '@core/services/cart/cart-gifts';
import type { CartLineGift } from '@core/services/cart/cart.model';
import type { GiftChoiceFacts, ProductGiftOffer } from '@core/services/offers/engine';
import type { ProductTypeId } from '@core/services/products';
import type { ChoicePrompt } from '../models/product-page.model';

export { toGiftChoice, type GiftChoiceView, type GiftSizeView } from '@core/services/cart/cart-gifts';

/** One gift of the offer ("Free shirt") with what it can be. */
export interface GiftView {
  readonly id: string;
  readonly name: string;
  /** The thing itself, lower case: "shirt" for "Free shirt". */
  readonly noun: string;
  readonly choices: readonly GiftChoiceView[];
}

/** Everything the Gift Box shows for one product. */
export interface GiftBoxView {
  readonly offerId: string;
  /** "Free shirt and socks with this bag". */
  readonly heading: string;
  readonly gifts: readonly GiftView[];
}

/** What the shopper picked for one gift. */
export interface GiftPick {
  readonly productId: string;
  readonly sizeId: string | null;
}

/** Gift id -> pick. */
export type GiftPicks = Readonly<Record<string, GiftPick>>;

/**
 * How a gift's row looks in the Gift Box:
 * - `included`: one product with no sizes, given as it is ("Included" with a tick).
 * - `sizes`: one product with sizes; its size buttons sit in the row.
 * - `pick`: two or more products; Choose / Change opens the gift panel.
 */
export type GiftRowKind = 'included' | 'sizes' | 'pick';

/** One gift's row in the Gift Box. */
export interface GiftRow {
  readonly kind: GiftRowKind;
  readonly gift: GiftView;
  /** "Your free shirt". */
  readonly title: string;
  /** The chosen product, or null. */
  readonly choice: GiftChoiceView | null;
  /** The chosen size's id and label, or null. */
  readonly sizeId: string | null;
  readonly sizeLabel: string | null;
  /** Product and size (when it has sizes) both chosen. */
  readonly done: boolean;
  /** Photos shown side by side when nothing is chosen yet in a long list (9 or more choices). */
  readonly peek: readonly GiftChoiceView[];
  /** How many choices the peek leaves out ("+10"). */
  readonly more: number;
  /** The line under the title: what is chosen, or what to do. */
  readonly detail: string;
}

/** From this many choices a gift row shows a peek of photos and the panel adds filters. */
export const GIFT_LONG_LIST = 9;

/** Prompt key for a gift's product step and size step (never clashes with option keys). */
export const giftStepKey = (giftId: string): string => `gift:${giftId}`;
export const giftSizeStepKey = (giftId: string): string => `gift-size:${giftId}`;

/** What follows "with" in the heading. Plural products read "these". */
const PRODUCT_NOUN_PHRASE: Readonly<Record<ProductTypeId, string>> = {
  rackets: 'this racket',
  bags: 'this bag',
  't-shirts': 'this shirt',
  shorts: 'these shorts',
  socks: 'these socks',
  sets: 'this set',
  grips: 'this grip',
  balls: 'these balls',
  bottles: 'this bottle',
  supports: 'this support',
};

/** "This racket", "These shorts": the product being viewed, as the Bundle & Save section names it. */
export function thisProductPhrase(productType: ProductTypeId): string {
  const phrase = PRODUCT_NOUN_PHRASE[productType] ?? 'this item';
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Facts the engine needs to pick the live gift offer: every listed choice can be given. */
export function giftChoiceFacts(choices: readonly GiftChoiceView[]): GiftChoiceFacts[] {
  return choices.map((choice) => ({ productId: choice.productId, published: true, inStock: true }));
}

/** "Free shirt" -> "shirt"; "Socks" -> "socks". */
export function giftNoun(name: string): string {
  const noun = name.trim().replace(/^free\s+/i, '');
  return (noun || 'gift').toLowerCase();
}

/** "a", "a and b", "a, b and c". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The Gift Box for one product, or null when the offer has no gift that can be given. */
export function buildGiftBox(
  offer: ProductGiftOffer,
  choices: readonly GiftChoiceView[],
  productType: ProductTypeId,
): GiftBoxView | null {
  const byId = new Map(choices.map((choice) => [choice.productId, choice]));
  const gifts: GiftView[] = [];
  for (const gift of offer.gifts) {
    const giftChoices = gift.productIds.flatMap((id) => {
      const choice = byId.get(id);
      return choice ? [choice] : [];
    });
    if (giftChoices.length === 0) continue;
    gifts.push({
      id: gift.id,
      name: gift.name.trim(),
      noun: giftNoun(gift.name),
      choices: giftChoices,
    });
  }
  if (gifts.length === 0) return null;
  const nouns = gifts.map((gift) => gift.noun);
  const phrase = PRODUCT_NOUN_PHRASE[productType] ?? 'this item';
  return { offerId: offer.offerId, heading: `Free ${joinNames(nouns)} with ${phrase}`, gifts };
}

/**
 * The picks that still hold: a product the gift still offers, a size that is still listed.
 * A gift with only one product is picked for the shopper (its size, if any, is left to choose).
 */
export function effectiveGiftPicks(box: GiftBoxView, picks: GiftPicks): GiftPicks {
  const result: Record<string, GiftPick> = {};
  for (const gift of box.gifts) {
    const pick = picks[gift.id];
    const choice = pick ? gift.choices.find((entry) => entry.productId === pick.productId) : undefined;
    if (pick && choice) {
      const sizeId =
        choice.sizes && pick.sizeId && choice.sizes.some((size) => size.id === pick.sizeId)
          ? pick.sizeId
          : null;
      result[gift.id] = { productId: choice.productId, sizeId };
    } else if (gift.choices.length === 1) {
      // Only one product: it is the gift (its size, when it has sizes, is still to choose).
      result[gift.id] = { productId: gift.choices[0].productId, sizeId: null };
    }
  }
  return result;
}

/** One row per gift, in the offer's order. */
export function giftRows(box: GiftBoxView, picks: GiftPicks): GiftRow[] {
  return box.gifts.map((gift) => {
    const pick = picks[gift.id];
    const choice = pick ? (gift.choices.find((entry) => entry.productId === pick.productId) ?? null) : null;
    const size = choice?.sizes?.find((entry) => entry.id === pick?.sizeId) ?? null;
    const only = gift.choices.length === 1 ? gift.choices[0] : null;
    const kind: GiftRowKind = only ? (only.sizes ? 'sizes' : 'included') : 'pick';
    const done = !!choice && (!choice.sizes || !!size);
    const long = gift.choices.length >= GIFT_LONG_LIST;
    const peek = !choice && long ? gift.choices.slice(0, 2) : [];
    return {
      kind,
      gift,
      title: `Your free ${gift.noun}`,
      choice,
      sizeId: size?.id ?? null,
      sizeLabel: size?.label ?? null,
      done,
      peek,
      more: peek.length > 0 ? gift.choices.length - peek.length : 0,
      detail: giftRowDetail(kind, gift, choice, size?.label ?? null),
    };
  });
}

function giftRowDetail(
  kind: GiftRowKind,
  gift: GiftView,
  choice: GiftChoiceView | null,
  sizeLabel: string | null,
): string {
  if (kind === 'included') return choice?.label ?? gift.choices[0].label;
  if (kind === 'sizes') return gift.choices[0].label;
  if (!choice) {
    if (gift.choices.length >= GIFT_LONG_LIST) return `${gift.choices.length} to choose from`;
    return gift.choices.some((entry) => entry.sizes) ? 'Choose one and its size' : 'Choose one';
  }
  if (!choice.sizes) return choice.label;
  // Size first, so it still shows when a long name is cut short.
  return sizeLabel ? `Size ${sizeLabel} · ${choice.label}` : `Pick a size · ${choice.label}`;
}

/** What the gifts are worth in EGP: each gift's highest-priced choice, added up (0 when unknown). */
export function giftBoxWorth(box: GiftBoxView): number {
  return box.gifts.reduce(
    (sum, gift) => sum + Math.max(0, ...gift.choices.map((choice) => (choice.price > 0 ? choice.price : 0))),
    0,
  );
}

/** The first gift step still open, as the prompt Add to Bag shows; null when every gift is chosen. */
export function missingGiftPrompt(box: GiftBoxView, picks: GiftPicks, attempt: number): ChoicePrompt | null {
  for (const gift of box.gifts) {
    const pick = picks[gift.id];
    if (!pick) {
      return { key: giftStepKey(gift.id), message: `Choose your free ${gift.noun} first.`, attempt };
    }
    const choice = gift.choices.find((entry) => entry.productId === pick.productId);
    if (choice?.sizes && !pick.sizeId) {
      return {
        key: giftSizeStepKey(gift.id),
        message: `Choose a size for your free ${gift.noun} first.`,
        attempt,
      };
    }
  }
  return null;
}

/** The bag line's gifts, or null while a gift is still open. */
export function cartLineGifts(box: GiftBoxView, picks: GiftPicks): CartLineGift[] | null {
  if (missingGiftPrompt(box, picks, 0)) return null;
  return box.gifts.map((gift) => ({
    offerId: box.offerId,
    giftId: gift.id,
    productId: picks[gift.id].productId,
    sizeId: picks[gift.id].sizeId,
  }));
}
