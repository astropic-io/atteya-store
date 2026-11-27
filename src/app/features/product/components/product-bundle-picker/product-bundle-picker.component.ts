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
import { MatRadioModule } from '@angular/material/radio';
import type { OfferBundleRow } from '@core/services/offers/engine';
import type { ChoicePrompt } from '../../models/product-page.model';
import type { GiftChoiceView } from '@core/services/cart/cart-gifts';
import { ChoicePickerService } from '../../dialogs/choice-picker/choice-picker.service';
import { type ChoiceRowView, choiceRowView } from '../../utils/choice-rows';
import type { BundleStep } from '../../utils/product-bundle';
import { ChoiceRowComponent } from '../choice-row/choice-row.component';

/** One quantity row as the picker shows it, amounts already written in the visitor's currency. */
export interface BundleRowView {
  readonly row: OfferBundleRow;
  /** "Get 2 for EGP 200". */
  readonly title: string;
  /** The price of one piece in this row. */
  readonly perPiece: string;
  /** The full price of one piece, struck through; empty when the row saves nothing. */
  readonly fullPrice: string;
  /** Whole percent saved; 0 hides the tag. */
  readonly savePercent: number;
}

/** One piece of the picked row, as a row that opens the choice panel. */
interface PieceRow {
  readonly piece: number;
  /** Prompt keys of the piece's product and size steps. */
  readonly key: string;
  readonly sizeKey: string | null;
  /** "Piece 2". */
  readonly title: string;
  readonly choices: readonly GiftChoiceView[];
  readonly pickedId: string | null;
  readonly view: ChoiceRowView;
}

/**
 * Bundle price picker on the product page: one radio row per number of pieces, then one row per
 * piece in a box like the Gift Box (ATS-355): "Piece 2 · Size M · On Cloud Socks Black · Change".
 * Tapping a row opens the choice panel (`ChoicePickerService`), where the product and its size are
 * picked; "Next" moves on to the following piece that still needs a pick.
 */
@Component({
  selector: 'app-product-bundle-picker',
  imports: [MatRadioModule, ChoiceRowComponent],
  templateUrl: './product-bundle-picker.component.html',
  host: { class: 'block w-full' },
})
export class ProductBundlePickerComponent {
  readonly offerId = input.required<string>();
  readonly rows = input.required<readonly BundleRowView[]>();
  /** Number of pieces of the picked row. */
  readonly pieces = input.required<number>();
  readonly steps = input.required<readonly BundleStep[]>();
  readonly disabled = input<boolean>(false);
  /** Set by the page when Add to Bag is pressed before every piece is chosen. */
  readonly prompt = input<ChoicePrompt | null>(null);

  readonly rowPicked = output<number>();
  readonly productPicked = output<{ piece: number; productId: string }>();
  readonly sizePicked = output<{ piece: number; sizeId: string }>();

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);
  readonly #picker = inject(ChoicePickerService);

  readonly pieceRows = computed<readonly PieceRow[]>(() => {
    const steps = this.steps();
    return steps.flatMap((step) => {
      if (step.kind !== 'piece') return [];
      const size = steps.find((entry) => entry.kind === 'size' && entry.piece === step.piece);
      return [
        {
          piece: step.piece,
          key: step.key,
          sizeKey: size?.key ?? null,
          title: step.title,
          choices: step.choices,
          pickedId: step.pickedId,
          view: choiceRowView(step.choices, step.pickedId, size?.kind === 'size' ? size.pickedId : null),
        },
      ];
    });
  });

  readonly groupLabelId = computed(() => `pdp-bundle-heading-${this.offerId()}`);

  constructor() {
    effect(() => {
      const prompt = this.prompt();
      if (!prompt) return;
      untracked(() =>
        afterNextRender({ write: () => this.#focusStep(prompt.key) }, { injector: this.#injector }),
      );
    });
  }

  /** The red message belongs to this piece (its product or its size is the open step). */
  promptFor(row: PieceRow): string | null {
    const prompt = this.prompt();
    return prompt && (prompt.key === row.key || prompt.key === row.sizeKey) ? prompt.message : null;
  }

  /** Opens the choice panel for a piece; "Next" moves on to the following piece that still needs a pick. */
  async open(piece: number, trigger: HTMLElement | null): Promise<void> {
    if (this.disabled()) return;
    const rows = this.pieceRows();
    const index = rows.findIndex((row) => row.piece === piece);
    if (index < 0) return;
    const row = rows[index];
    const next = rows.slice(index + 1).find((entry) => !entry.view.done) ?? null;
    let result: Awaited<ReturnType<ChoicePickerService['open']>>;
    try {
      result = await this.#picker.open(
        {
          choices: row.choices,
          title: row.title,
          step: `Bundle price · ${index + 1} of ${rows.length}`,
          pick: row.pickedId ? { productId: row.pickedId, sizeId: row.view.sizeId } : null,
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
    return this.#host.nativeElement.querySelector<HTMLElement>(`[data-bundle-piece="${piece}"] button`);
  }

  /** Focuses the row of the piece a prompt key ("bundle:1", "bundle-size:1") names. */
  #focusStep(key: string): void {
    const piece = Number(key.split(':')[1]);
    if (Number.isInteger(piece)) this.#rowButton(piece)?.focus();
  }
}
