import { isPlatformBrowser } from '@angular/common';
import { inject, Injector, PLATFORM_ID, Service } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { createGlobalPositionStrategy } from '@angular/cdk/overlay';
import { firstValueFrom } from 'rxjs';
import type { ChoicePickerData, ChoicePickerResult } from './choice-picker.model';
// Type only: the panel itself is loaded on first open.
import type { ChoicePickerComponent } from './choice-picker.component';

/** From this width the panel slides in from the right; below it, a sheet rises from the bottom. */
const SIDE_PANEL_QUERY = '(min-width: 1024px)';

/**
 * Opens the choice panel (`app-choice-picker`, ATS-349, ATS-355) for one row of a product page offer box
 * (Gift Box, Bundle price picker, Bundle & Save):
 * a side panel from the right on desktop, a sheet from the bottom on phone and tablet. CDK Dialog
 * gives the focus trap, page scroll lock and focus return to the row. The panel is loaded on first
 * open, so it stays out of the product page's first bundle. Resolves with what was picked, or
 * undefined when nothing was.
 */
@Service()
export class ChoicePickerService {
  readonly #dialog = inject(Dialog);
  readonly #injector = inject(Injector);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  #open = false;

  async open(data: ChoicePickerData, trigger: HTMLElement | null): Promise<ChoicePickerResult | undefined> {
    if (!this.#isBrowser || this.#open) return undefined;
    this.#open = true;
    try {
      let component: typeof ChoicePickerComponent;
      try {
        ({ ChoicePickerComponent: component } = await import('./choice-picker.component'));
      } catch {
        // The panel couldn't load (offline or a new release): the shopper can tap the row again.
        return undefined;
      }
      const side = window.matchMedia(SIDE_PANEL_QUERY).matches;
      const position = createGlobalPositionStrategy(this.#injector).right('0');
      const ref = this.#dialog.open<ChoicePickerResult, ChoicePickerData, ChoicePickerComponent>(component, {
        data,
        ariaLabelledBy: 'choice-picker-title',
        hasBackdrop: true,
        backdropClass: 'cdk-overlay-dark-backdrop',
        panelClass: 'choice-picker-pane',
        maxWidth: '100vw',
        maxHeight: '100dvh',
        // The panel closes itself on Esc and backdrop clicks, so it can hand back what was picked.
        disableClose: true,
        positionStrategy: side ? position.top('0') : position.bottom('0'),
        autoFocus: 'first-heading',
        restoreFocus: trigger ?? true,
      });
      return await firstValueFrom(ref.closed);
    } finally {
      this.#open = false;
    }
  }
}
