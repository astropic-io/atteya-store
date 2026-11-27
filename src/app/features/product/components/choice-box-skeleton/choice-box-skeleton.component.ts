import { Component, input } from '@angular/core';
import { SkeletonComponent } from '@shared/ui/skeleton';

/**
 * Placeholder the shape of an offer box (Gift Box, Bundle price pieces, Bundle & Save; ATS-349,
 * ATS-355) while its products load, server render included, so nothing moves when the real box
 * appears: an optional white header, two short rows and an optional full-width button.
 */
@Component({
  selector: 'app-choice-box-skeleton',
  imports: [SkeletonComponent],
  template: `
    <div class="pdp-gift-box" aria-hidden="true">
      @if (header()) {
        <div class="pdp-gift-box__head">
          <app-skeleton class="h-5 w-20" />
          <app-skeleton class="h-6 w-3/4" />
        </div>
      }
      @for (n of [1, 2]; track n) {
        <div class="pdp-gift-line">
          <div class="pdp-gift-item">
            <app-skeleton class="pdp-gift-thumb" />
            <span class="pdp-gift-item__text">
              <app-skeleton class="h-5 w-32" />
              <app-skeleton class="h-4 w-40" />
            </span>
          </div>
        </div>
      }
      @if (button()) {
        <div class="p-4"><app-skeleton class="h-12 w-full" /></div>
      }
    </div>
  `,
  host: { class: 'block w-full' },
})
export class ChoiceBoxSkeletonComponent {
  /** The white header with the tag and heading (Gift Box, Bundle & Save). */
  readonly header = input<boolean>(false);
  /** A full-width button at the bottom (Bundle & Save's Add Bundle to Bag). */
  readonly button = input<boolean>(false);
}
