import { makeStateKey } from '@angular/core';
import type { PublicCurrencyMap } from './currency.schema';

/** Geo + display currency resolved on the server for TransferState. */
export interface CurrencyBootTransfer {
  readonly country: string | null;
  /**
   * Display currency the server rendered. Null when the visitor's country could not be
   * found (ATS-313): the server rendered EGP with prices hidden (`data-cur-pending`) and
   * the browser decides by its time zone.
   */
  readonly code: string | null;
  readonly map: PublicCurrencyMap | null;
  /**
   * Prerendered page (no visitor request): the server tried no lookup, so the browser
   * hydrates the hidden EGP render and then runs the full geo lookup, not only the time zone.
   */
  readonly prerendered?: boolean;
}

export const CURRENCY_BOOT_KEY = makeStateKey<CurrencyBootTransfer>('currency-boot');
