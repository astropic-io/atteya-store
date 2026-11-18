import { Component, computed, input, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { HorizontalScrollDirective } from '@shared/directives/horizontal-scroll';
import type { SizeGuide, SizeUnit } from '../../utils/size-guide';

/** Size chart for the product page's Size & Fit section. */
@Component({
  selector: 'app-size-guide',
  imports: [MatButtonToggleModule, HorizontalScrollDirective],
  templateUrl: './size-guide.component.html',
  host: { class: 'block w-full' },
})
export class SizeGuideComponent {
  readonly guide = input.required<SizeGuide>();

  readonly unit = signal<SizeUnit>('cm');

  /** Weight-only charts (hoodies) always read in kilograms, so the unit switch is hidden there. */
  readonly intro = computed(() =>
    this.guide().hasLengths
      ? `Weight is your body weight in kilograms. Width and length are the shirt's own measurements in ${this.unit() === 'cm' ? 'centimetres' : 'inches'}.`
      : 'Find your size by your body weight in kilograms.',
  );
}
