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
import type { CartLineDraft } from '@core/services/cart/cart.model';
import type { ChoicePrompt } from '../../models/product-page.model';
import type { GiftChoiceView } from '@core/services/cart/cart-gifts';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { ChoicePickerService } from '../../dialogs/choice-picker/choice-picker.service';
import { type ChoiceRowView, choiceRowView } from '../../utils/choice-rows';
import type { BundleSaveStep } from '../../utils/product-bundle-save';
import { AddToBagButtonComponent } from '../add-to-bag-button/add-to-bag-button.component';
import { ChoiceRowComponent } from '../choice-row/choice-row.component';

/** One piece of the set: this product's own (nothing to pick), or a row that opens the choice panel. */
interface SetRow {
  readonly piece: number;
  /** Prompt keys of the piece's product and size steps. */
  readonly key: string;
  readonly sizeKey: string | null;
  /** "Racket", "Socks" (the step number left out). */
  readonly title: string;
  /** This product's own piece: "This racket", done once its size and gifts above are chosen. */
  readonly own: { readonly text: string; readonly done: boolean } | null;
  readonly choices: readonly GiftChoiceView[];
  readonly pickedId: string | null;
  readonly view: ChoiceRowView | null;
}

/**
 * Bundle & Save on the product page (ATS-355): a white header with the "Bundle & Save" tag, the
 * saving and the offer title, then one row per piece of the set, like the Gift Box. The product
 * being viewed fills its own row ("This racket", "Included" once its choices above are made); every
 * other piece is a row that opens the choice panel (`ChoicePickerService`), where its product and
 * size are picked. Ends with **Add Bundle to Bag**, which adds every piece in one change.
 */
@Component({
  selector: 'app-product-bundle-save',
  imports: [ChoiceRowComponent, AddToBagButtonComponent, SharedIconModule],
  templateUrl: './product-bundle-save.component.html',
  host: { class: 'block w-full' },
})
export class ProductBundleSaveComponent {
  readonly offerId = input.required<string>();
  /** The offer's title. */
  readonly title = input.required<string>();
  /** "Save EGP 300", "Save 15%", "Cheapest item free". */
  readonly saving = input.required<string>();
  readonly steps = input.required<readonly BundleSaveStep[]>();
  /** One bag line per piece, or null while a piece (or this product's own choice) is still open. */
  readonly lines = input<readonly CartLineDraft[] | null>(null);
  /** "Add Bundle to Bag · EGP 4,900". */
  readonly buttonLabel = input.required<string>();
  readonly disabled = input<boolean>(false);
  /** Set by the page when Add Bundle to Bag is pressed before every piece is chosen. */
  readonly prompt = input<ChoicePrompt | null>(null);

  readonly productPicked = output<{ piece: number; productId: string }>();
  readonly sizePicked = output<{ piece: number; sizeId: string }>();
  readonly choiceMissing = output<void>();

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);
  readonly #picker = inject(ChoicePickerService);

  readonly rows = computed<readonly SetRow[]>(() => {
    const steps = this.steps();
    return steps.flatMap((step): SetRow[] => {
      // "1. Racket" reads "Racket": the rows are already in order.
      const title = step.title.replace(/^\d+\.\s*/, '');
      if (step.kind === 'own') {
        const own = { text: step.text, done: step.done };
        return [
          {
            piece: step.piece,
            key: step.key,
            sizeKey: null,
            title,
            own,
            choices: [],
            pickedId: null,
            view: null,
          },
        ];
      }
      if (step.kind !== 'piece') return [];
      const size = steps.find((entry) => entry.kind === 'size' && entry.piece === step.piece);
      const sizeId = size?.kind === 'size' ? size.pickedId : null;
      return [
        {
          piece: step.piece,
          key: step.key,
          sizeKey: size?.key ?? null,
          title,
          own: null,
          choices: step.choices,
          pickedId: step.pickedId,
          view: choiceRowView(step.choices, step.pickedId, sizeId),
        },
      ];
    });
  });

  readonly headingId = computed(() => `pdp-set-heading-${this.offerId()}`);

  constructor() {
    effect(() => {
      const prompt = this.prompt();
      if (!prompt || !prompt.key.startsWith('set')) return;
      untracked(() =>
        afterNextRender({ write: () => this.#focusStep(prompt.key) }, { injector: this.#injector }),
      );
    });
  }

  /** The red message belongs to this piece (its product or its size is the open step). */
  promptFor(row: SetRow): string | null {
    const prompt = this.prompt();
    return prompt && (prompt.key === row.key || prompt.key === row.sizeKey) ? prompt.message : null;
  }

  /** Opens the choice panel for a piece; "Next" moves on to the following piece that still needs a pick. */
  async open(piece: number, trigger: HTMLElement | null): Promise<void> {
    if (this.disabled()) return;
    const rows = this.rows().filter((row) => row.view);
    const index = rows.findIndex((row) => row.piece === piece);
    if (index < 0) return;
    const row = rows[index];
    const next = rows.slice(index + 1).find((entry) => !entry.view?.done) ?? null;
    let result: Awaited<ReturnType<ChoicePickerService['open']>>;
    try {
      result = await this.#picker.open(
        {
          choices: row.choices,
          title: row.title,
          step: `Bundle & Save · ${index + 1} of ${rows.length}`,
          pick: row.pickedId ? { productId: row.pickedId, sizeId: row.view?.sizeId ?? null } : null,
          next: next?.title ?? null,
          hint: 'Tap a photo to pick this piece.',
        },
        trigger,
      );
    } catch {
      // The panel couldn't open: the row stays as it was and the shopper can tap it again.
      return;
    }
    if (!result) return;
    this.productPicked.emit({ piece, productId: result.productId });
    if (result.sizeId) this.sizePicked.emit({ piece, sizeId: result.sizeId });
    if (result.next && next) await this.open(next.piece, this.#rowButton(next.piece));
  }

  #rowButton(piece: number): HTMLElement | null {
    return this.#host.nativeElement.querySelector<HTMLElement>(`[data-set-piece="${piece}"] button`);
  }

  /** Focuses the row of the piece a prompt key ("set:1", "set-size:1") names. */
  #focusStep(key: string): void {
    const piece = Number(key.split(':')[1]);
    if (Number.isInteger(piece)) this.#rowButton(piece)?.focus();
  }
}
