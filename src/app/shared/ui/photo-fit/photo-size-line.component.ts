import { Component, computed, input } from '@angular/core';
import { PHOTO_FILE_HINT, PhotoSpot, photoShapeLabel, photoSizeLabel } from '@shared/utils/image';

/** The size to use for a photo spot: "1600 × 2000 px  Portrait, 4 wide by 5 tall. …" (ATS-328). */
@Component({
  selector: 'app-photo-size-line',
  host: { class: 'block w-full' },
  template: `
    <p class="photo-size-line">
      <span class="photo-size-chip">{{ best() }}</span>
      <span class="opacity-80">
        {{ shape() }}. At least {{ smallest() }} to look sharp. {{ fileHint }}.
      </span>
    </p>
  `,
})
export class PhotoSizeLineComponent {
  readonly spot = input.required<PhotoSpot>();

  readonly fileHint = PHOTO_FILE_HINT;
  readonly best = computed(() => photoSizeLabel(this.spot().best));
  readonly smallest = computed(() => photoSizeLabel(this.spot().smallest));
  readonly shape = computed(() => photoShapeLabel(this.spot()));
}
