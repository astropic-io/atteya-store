import { Component, computed, input } from '@angular/core';
import { SharedIconModule } from '@shared/ui/mat-icon';
import {
  PhotoSpot,
  checkPhotoFit,
  photoFitMessage,
  photoSizeLabel,
  photoSmallMessage,
} from '@shared/utils/image';

/**
 * Under a photo preview: "Your photo: W × H px", then what gets cut or "Fits the card", and a
 * blur warning for a small photo. Only a note: it never blocks saving (ATS-328).
 */
@Component({
  selector: 'app-photo-fit-note',
  host: { class: 'block w-full' },
  imports: [SharedIconModule],
  template: `
    @if (fit(); as current) {
      <div class="flex flex-col gap-1.5" aria-live="polite">
        <p class="font-label-md opacity-80">Your photo: {{ sizeLabel() }}</p>
        @if (!current.fits) {
          <p class="photo-fit-warning">
            <mat-icon name="warning" size="sm" />
            <span>{{ fitMessage() }}</span>
          </p>
        }
        @if (current.isSmall) {
          <p class="photo-fit-warning">
            <mat-icon name="warning" size="sm" />
            <span>{{ smallMessage() }}</span>
          </p>
        }
        @if (current.fits && !current.isSmall) {
          <p class="photo-fit-ok">
            <mat-icon name="check_circle" size="sm" />
            <span>{{ fitMessage() }}</span>
          </p>
        }
      </div>
    }
  `,
})
export class PhotoFitNoteComponent {
  readonly spot = input.required<PhotoSpot>();
  readonly width = input<number | undefined>(undefined);
  readonly height = input<number | undefined>(undefined);

  readonly fit = computed(() => checkPhotoFit(this.spot(), this.width(), this.height()));
  readonly sizeLabel = computed(() => {
    const fit = this.fit();
    return fit ? photoSizeLabel(fit.size) : '';
  });
  readonly fitMessage = computed(() => {
    const fit = this.fit();
    return fit ? photoFitMessage(this.spot(), fit) : '';
  });
  readonly smallMessage = computed(() => photoSmallMessage(this.spot()));
}
