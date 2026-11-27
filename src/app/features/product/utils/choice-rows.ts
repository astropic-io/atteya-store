import type { GiftChoiceView } from '@core/services/cart/cart-gifts';

/** From this many choices a row shows a peek of photos and the panel shows its count line (filters show at any length, ATS-359). */
export const CHOICE_LONG_LIST = 9;

/** What a row that opens the choice panel shows (`app-choice-row`). */
export interface ChoiceRowView {
  /** The picked product, or null. */
  readonly choice: GiftChoiceView | null;
  readonly sizeId: string | null;
  readonly sizeLabel: string | null;
  /** A product is picked, and its size when it has sizes. */
  readonly done: boolean;
  /** Two small photos while nothing is picked and the list is long. */
  readonly peek: readonly GiftChoiceView[];
  /** The "+N" after the peek (0 hides it). */
  readonly more: number;
  /** "Size M · Adidas Ale Galán T-Shirt Black", "Choose one and its size", "12 to choose from". */
  readonly detail: string;
}

/**
 * The row for a list of choices and what is picked: the photo and the pick, or what to do.
 * A size that is no longer listed counts as not picked.
 */
export function choiceRowView(
  choices: readonly GiftChoiceView[],
  pickedId: string | null,
  sizeId: string | null,
): ChoiceRowView {
  const choice = pickedId ? (choices.find((entry) => entry.productId === pickedId) ?? null) : null;
  const size = choice?.sizes?.find((entry) => entry.id === sizeId) ?? null;
  const long = choices.length >= CHOICE_LONG_LIST;
  const peek = !choice && long ? choices.slice(0, 2) : [];
  return {
    choice,
    sizeId: size?.id ?? null,
    sizeLabel: size?.label ?? null,
    done: !!choice && (!choice.sizes || !!size),
    peek,
    more: peek.length > 0 ? choices.length - peek.length : 0,
    detail: choiceRowDetail(choices, choice, size?.label ?? null),
  };
}

function choiceRowDetail(
  choices: readonly GiftChoiceView[],
  choice: GiftChoiceView | null,
  sizeLabel: string | null,
): string {
  if (!choice) {
    if (choices.length >= CHOICE_LONG_LIST) return `${choices.length} to choose from`;
    return choices.some((entry) => entry.sizes) ? 'Choose one and its size' : 'Choose one';
  }
  if (!choice.sizes) return choice.label;
  // Size first, so it still shows when a long name is cut short.
  return sizeLabel ? `Size ${sizeLabel} · ${choice.label}` : `Pick a size · ${choice.label}`;
}
