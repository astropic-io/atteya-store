import { NgOptimizedImage } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatButtonModule } from '@angular/material/button';
import type { GiftChoiceView } from '@core/services/cart/cart-gifts';
import type { GiftCardColour } from '@core/services/cart/gift-card-label';
import { CatalogService } from '@core/services/products/catalog.service';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { ColorSwatchComponent } from '@shared/ui/color-swatch/color-swatch.component';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { normalizeImageKitPath } from '@shared/utils/image';
import { GIFT_LONG_LIST } from '../../utils/product-gifts';
import type { GiftPickerData, GiftPickerResult } from './gift-picker.model';

/** From this many choices the panel shows a search field too. */
const SEARCH_FROM = 20;
/** Cards shown at first, and how many more "Show More" adds. */
const PAGE = 12;

interface BrandFilter {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

/**
 * The gift panel (ATS-349), opened by `GiftPickerService` from a Gift Box row: a side panel on
 * desktop, a sheet from the bottom on phone. Photo cards of the gift's choices, colour and brand
 * filters from 9 choices and a search field from 20, 12 cards at a time. The picked product's
 * sizes sit in the pinned footer, with "Next: Your Free Socks" or "Done". Esc, the backdrop and the
 * close button keep what was picked.
 */
@Component({
  selector: 'app-gift-picker',
  host: { class: 'side-panel gift-picker', '[class.gift-picker--wide]': 'long' },
  imports: [
    NgOptimizedImage,
    AppImageFallbackDirective,
    MatButtonModule,
    ColorSwatchComponent,
    SharedIconModule,
  ],
  templateUrl: './gift-picker.component.html',
})
export class GiftPickerComponent {
  readonly #ref = inject<DialogRef<GiftPickerResult, GiftPickerComponent>>(DialogRef);
  readonly #catalog = inject(CatalogService);
  readonly data = inject<GiftPickerData>(DIALOG_DATA);

  readonly path = normalizeImageKitPath;
  readonly choices = this.data.gift.choices;
  readonly long = this.choices.length >= GIFT_LONG_LIST;
  readonly searchable = this.choices.length >= SEARCH_FROM;

  readonly selectedId = signal<string | null>(this.#validPick());
  readonly sizeId = signal<string | null>(this.data.pick?.sizeId ?? null);
  readonly colour = signal<string | null>(null);
  readonly brand = signal<string | null>(null);
  readonly query = signal('');
  readonly shown = signal(PAGE);
  /** Set when Next or Done is pressed before a size is picked. */
  readonly needSize = signal(false);

  readonly selected = computed(
    () => this.choices.find((choice) => choice.productId === this.selectedId()) ?? null,
  );
  readonly sizes = computed(() => this.selected()?.sizes ?? null);

  /** Colour dots, only when the list is long and has 2 or more colours. */
  readonly colours = computed<readonly GiftCardColour[]>(() => {
    if (!this.long) return [];
    const seen = new Map<string, GiftCardColour>();
    for (const choice of this.choices) for (const colour of choice.cardColours) seen.set(colour.id, colour);
    return seen.size >= 2 ? [...seen.values()] : [];
  });

  /** Brand buttons with counts, only when the list is long and has 2 or more brands. */
  readonly brands = computed<readonly BrandFilter[]>(() => {
    if (!this.long) return [];
    const counts = new Map<string, number>();
    for (const choice of this.choices) {
      if (choice.brandId) counts.set(choice.brandId, (counts.get(choice.brandId) ?? 0) + 1);
    }
    if (counts.size < 2) return [];
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count, name: this.#catalog.brandBySlug(id)?.name ?? id }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  readonly filtered = computed(() => {
    const colour = this.colour();
    const brand = this.brand();
    const words = this.query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.choices.filter((choice) => {
      if (colour && !choice.cardColours.some((entry) => entry.id === colour)) return false;
      if (brand && choice.brandId !== brand) return false;
      if (words.length === 0) return true;
      const text = this.#searchText(choice);
      return words.every((word) => text.includes(word));
    });
  });

  readonly visible = computed(() => this.filtered().slice(0, this.shown()));
  readonly remaining = computed(() => Math.max(0, this.filtered().length - this.shown()));
  readonly nextPage = computed(() => Math.min(PAGE, this.remaining()));
  readonly filtering = computed(() => !!this.colour() || !!this.brand() || this.query().trim() !== '');

  /** "Next: Your Free Socks" when another gift still needs a pick, otherwise "Done". */
  readonly cta = this.data.next ? `Next: ${titleCase(this.data.next)}` : 'Done';

  constructor() {
    const backdrop = this.#ref.backdropClick.subscribe(() => this.close());
    const keys = this.#ref.keydownEvents.subscribe((event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      backdrop.unsubscribe();
      keys.unsubscribe();
    });
  }

  pick(productId: string): void {
    if (this.selectedId() === productId) return;
    this.selectedId.set(productId);
    // Back on the product that was already picked: its size comes back too.
    this.sizeId.set(productId === this.data.pick?.productId ? (this.data.pick.sizeId ?? null) : null);
    this.needSize.set(false);
  }

  pickSize(sizeId: string): void {
    this.sizeId.set(sizeId);
    this.needSize.set(false);
  }

  setColour(id: string | null): void {
    this.colour.set(this.colour() === id ? null : id);
    this.shown.set(PAGE);
  }

  setBrand(id: string | null): void {
    this.brand.set(this.brand() === id ? null : id);
    this.shown.set(PAGE);
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.shown.set(PAGE);
  }

  clearFilters(): void {
    this.colour.set(null);
    this.brand.set(null);
    this.query.set('');
    this.shown.set(PAGE);
  }

  showMore(): void {
    this.shown.update((count) => count + PAGE);
  }

  /** Next or Done: needs a pick (and its size, when it has sizes). */
  finish(): void {
    const selected = this.selected();
    if (!selected) return;
    if (this.sizes()?.length && !this.sizeId()) {
      this.needSize.set(true);
      return;
    }
    this.#ref.close({ productId: selected.productId, sizeId: this.sizeId(), next: !!this.data.next });
  }

  /**
   * Close button, Esc or the backdrop: keep a finished pick (a product, and its size when it has
   * sizes), without moving on. A product tapped only to look at it leaves the earlier pick as it was.
   */
  close(): void {
    const selected = this.selected();
    const finished = !!selected && (!this.sizes()?.length || !!this.sizeId());
    this.#ref.close(
      finished && selected
        ? { productId: selected.productId, sizeId: this.sizeId(), next: false }
        : undefined,
    );
  }

  #validPick(): string | null {
    const id = this.data.pick?.productId ?? null;
    return id && this.data.gift.choices.some((choice) => choice.productId === id) ? id : null;
  }

  #searchText(choice: GiftChoiceView): string {
    const brand = choice.brandId ? (this.#catalog.brandBySlug(choice.brandId)?.name ?? choice.brandId) : '';
    return [choice.label, brand, ...choice.cardColours.map((colour) => colour.label)].join(' ').toLowerCase();
  }
}

const SMALL_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'on',
  'in',
  'at',
  'to',
  'by',
  'for',
  'with',
  'from',
]);

/** "Your free socks" → "Your Free Socks" (button title case). */
function titleCase(text: string): string {
  const words = text.split(' ');
  return words
    .map((word, index) =>
      index > 0 && index < words.length - 1 && SMALL_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}
