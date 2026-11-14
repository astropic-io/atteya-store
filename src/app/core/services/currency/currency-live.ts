import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';

/**
 * Value for a price element's `data-cur-live` attribute (ATS-323): `''` once drawn in the browser,
 * null in the server HTML. A block still waiting to hydrate (`@defer (hydrate on viewport)`) keeps
 * the server's prices, so the inline `<style>` in `src/index.html` hides any price without the mark while `html[data-cur-moved]`
 * says the currency changed. Call from an injection context.
 */
export function injectCurrencyLiveMark(): '' | null {
  return isPlatformBrowser(inject(PLATFORM_ID)) ? '' : null;
}
