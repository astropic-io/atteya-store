import { isPlatformBrowser } from '@angular/common';
import { inject, Injector, PLATFORM_ID, Service } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { createGlobalPositionStrategy } from '@angular/cdk/overlay';
import { firstValueFrom } from 'rxjs';
import type { GiftPickerData, GiftPickerResult } from './gift-picker.model';
// Type only: the panel itself is loaded on first open.
import type { GiftPickerComponent } from './gift-picker.component';

/** From this width the panel slides in from the right; below it, a sheet rises from the bottom. */
const SIDE_PANEL_QUERY = '(min-width: 1024px)';

/**
 * Opens the gift panel (`app-gift-picker`, ATS-349) for one gift of the product page's Gift Box:
 * a side panel from the right on desktop, a sheet from the bottom on phone and tablet. CDK Dialog
 * gives the focus trap, page scroll lock and focus return to the row. The panel is loaded on first
 * open, so it stays out of the product page's first bundle. Resolves with what was picked, or
 * undefined when nothing was.
 */
@Service()
export class GiftPickerService {
  readonly #dialog = inject(Dialog);
  readonly #injector = inject(Injector);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  #open = false;

  async open(data: GiftPickerData, trigger: HTMLElement | null): Promise<GiftPickerResult | undefined> {
    if (!this.#isBrowser || this.#open) return undefined;
    this.#open = true;
    try {
      let component: typeof GiftPickerComponent;
      try {
        ({ GiftPickerComponent: component } = await import('./gift-picker.component'));
      } catch {
        // The panel couldn't load (offline or a new release): the shopper can tap the row again.
        return undefined;
      }
      const side = window.matchMedia(SIDE_PANEL_QUERY).matches;
      const position = createGlobalPositionStrategy(this.#injector).right('0');
      const ref = this.#dialog.open<GiftPickerResult, GiftPickerData, GiftPickerComponent>(component, {
        data,
        ariaLabelledBy: 'gift-picker-title',
        hasBackdrop: true,
        backdropClass: 'cdk-overlay-dark-backdrop',
        panelClass: 'gift-picker-pane',
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
