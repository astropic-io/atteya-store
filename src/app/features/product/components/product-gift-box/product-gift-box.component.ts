import { NgOptimizedImage } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  untracked,
} from '@angular/core';
import { CurrencyService } from '@core/services/currency/currency.service';
import { displayDecimals, toDisplayAmount } from '@core/services/offers/engine';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { normalizeImageKitPath } from '@shared/utils/image';
import { formatMoney } from '@shared/utils/money';
import type { ChoicePrompt } from '../../models/product-page.model';
import { GiftPickerService } from '../../dialogs/gift-picker/gift-picker.service';
import {
  type GiftBoxView,
  type GiftPicks,
  type GiftRow,
  giftBoxWorth,
  giftRows,
  giftSizeStepKey,
  giftStepKey,
} from '../../utils/product-gifts';

/** Below this the gifts' value is not shown ("Worth EGP 30" reads as a joke). */
const MIN_WORTH_EGP = 50;

/**
 * Gift Box: the Free gift offer on the product page (ATS-349). A small black "Free gift" tag, what
 * the gifts are worth and the heading, then one short row per gift:
 * - one product with no sizes: "Included" with a tick, nothing to tap;
 * - one product with sizes: its size buttons sit in the row;
 * - two or more products: the row opens the gift panel (`GiftPickerService`), a side panel on
 *   desktop and a sheet from the bottom on phone, where the shopper picks the product and size.
 * Add to Bag with a gift still open shows the red message under that row and focuses it.
 */
@Component({
  selector: 'app-product-gift-box',
  imports: [NgOptimizedImage, AppImageFallbackDirective, SharedIconModule],
  templateUrl: './product-gift-box.component.html',
  host: { class: 'block w-full' },
})
export class ProductGiftBoxComponent {
  readonly box = input.required<GiftBoxView>();
  readonly picks = input.required<GiftPicks>();
  readonly disabled = input<boolean>(false);
  /** Set by the page when Add to Bag is pressed before every gift is chosen. */
  readonly prompt = input<ChoicePrompt | null>(null);

  readonly productPicked = output<{ giftId: string; productId: string }>();
  readonly sizePicked = output<{ giftId: string; sizeId: string }>();

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);
  readonly #currency = inject(CurrencyService);
  readonly #picker = inject(GiftPickerService);

  readonly path = normalizeImageKitPath;

  readonly rows = computed(() => giftRows(this.box(), this.picks()));

  /** "EGP 824" (or the shopper's own currency), or null when too small or unknown. */
  readonly worth = computed(() => {
    // Wait for the shopper's currency, so a shopper abroad never sees EGP first.
    if (!this.#currency.ready()) return null;
    const egp = giftBoxWorth(this.box());
    if (egp < MIN_WORTH_EGP) return null;
    const entry = this.#currency.entry();
    return formatMoney(toDisplayAmount(egp, entry), entry.code, displayDecimals(entry.code));
  });

  constructor() {
    effect(() => {
      const prompt = this.prompt();
      if (!prompt) return;
      untracked(() =>
        afterNextRender({ write: () => this.#focusRow(prompt.key) }, { injector: this.#injector }),
      );
    });
  }

  /** The red message belongs to this row (its product or its size is the open step). */
  promptFor(row: GiftRow): string | null {
    const prompt = this.prompt();
    if (!prompt) return null;
    const id = row.gift.id;
    return prompt.key === giftStepKey(id) || prompt.key === giftSizeStepKey(id) ? prompt.message : null;
  }

  /** Opens the gift panel for a row; "Next" moves on to the following gift that still needs a pick. */
  async open(giftId: string, trigger: EventTarget | null): Promise<void> {
    if (this.disabled()) return;
    const rows = this.rows();
    const index = rows.findIndex((row) => row.gift.id === giftId);
    if (index < 0) return;
    const row = rows[index];
    const next = rows.slice(index + 1).find((entry) => entry.kind !== 'included' && !entry.done) ?? null;
    let result: Awaited<ReturnType<GiftPickerService['open']>>;
    try {
      result = await this.#picker.open(
        {
          gift: row.gift,
          title: row.title,
          step: rows.length > 1 ? `Free gift · ${index + 1} of ${rows.length}` : 'Free gift',
          pick: this.picks()[giftId] ?? null,
          next: next?.title ?? null,
        },
        trigger instanceof HTMLElement ? trigger : null,
      );
    } catch {
      // The panel couldn't open: the row stays as it was and the shopper can tap it again.
      return;
    }
    if (!result) return;
    this.productPicked.emit({ giftId, productId: result.productId });
    if (result.sizeId) this.sizePicked.emit({ giftId, sizeId: result.sizeId });
    if (!result.next || !next) return;
    if (next.kind === 'pick') {
      const nextRow = this.#host.nativeElement.querySelector<HTMLElement>(
        `[data-gift-row="${CSS.escape(next.gift.id)}"]`,
      );
      await this.open(next.gift.id, nextRow);
    } else {
      afterNextRender(
        { write: () => this.#focusRow(giftSizeStepKey(next.gift.id)) },
        { injector: this.#injector },
      );
    }
  }

  #focusRow(key: string): void {
    const id = key.replace(/^gift(-size)?:/, '');
    const row = this.#host.nativeElement.querySelector(`[data-gift="${CSS.escape(id)}"]`);
    row?.querySelector<HTMLButtonElement>('button[data-choice]:not(:disabled)')?.focus();
  }
}
