import { NgOptimizedImage } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { normalizeImageKitPath } from '@shared/utils/image';
import type { ChoiceRowView } from '../../utils/choice-rows';

/**
 * One tappable row of a product page offer box (Gift Box, Bundle price picker, Bundle & Save;
 * ATS-349, ATS-355): the picked photo (or a peek of photos, or a "+" square), the row's title and
 * what is picked or what to do, then "Choose" / "Change". Tapping it asks the box to open the
 * choice panel (`ChoicePickerService`).
 */
@Component({
  selector: 'app-choice-row',
  imports: [NgOptimizedImage, AppImageFallbackDirective, SharedIconModule],
  templateUrl: './choice-row.component.html',
  host: { class: 'block w-full' },
})
export class ChoiceRowComponent {
  /** "Your free shirt", "Piece 2", "Your racket". */
  readonly title = input.required<string>();
  readonly view = input.required<ChoiceRowView>();
  readonly disabled = input<boolean>(false);
  /** Id of the red message under the row, while it shows. */
  readonly describedBy = input<string | null>(null);

  /** The row's button, so focus can go back to it when the panel closes. */
  readonly opened = output<HTMLElement>();

  readonly path = normalizeImageKitPath;
}
