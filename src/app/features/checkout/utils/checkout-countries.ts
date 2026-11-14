import { DELIVERY_COUNTRY_CODES } from '@core/services/offers/engine';

export interface CheckoutCountryOption {
  readonly code: string;
  readonly label: string;
}

/** English country names from the browser (and Node on the server), e.g. `BR` → "Brazil". */
function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Every country an order can be delivered to (ATS-314), Egypt first, then A to Z by name. Which
 * ones get a set shipping price abroad comes from Settings → Shipping (`hasSetShippingPrice()`);
 * any other country is placed with delivery and the fee agreed on WhatsApp.
 */
export const CHECKOUT_COUNTRY_OPTIONS: readonly CheckoutCountryOption[] = [
  { code: 'EG', label: regionName('EG') },
  ...DELIVERY_COUNTRY_CODES.filter((code) => code !== 'EG')
    .map((code) => ({ code, label: regionName(code) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en')),
];

const OPTION_BY_CODE: ReadonlyMap<string, CheckoutCountryOption> = new Map(
  CHECKOUT_COUNTRY_OPTIONS.map((entry) => [entry.code, entry]),
);

export type CheckoutCountryCode = string;

export function isCheckoutCountry(code: string): code is CheckoutCountryCode {
  return OPTION_BY_CODE.has(code);
}

export function countryLabel(code: string): string {
  return OPTION_BY_CODE.get(code)?.label ?? code;
}

/** Exact match on ISO code or full country label (for live typing). */
export function matchCheckoutCountryExact(query: string): CheckoutCountryCode | null {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return null;
  const exactCode = CHECKOUT_COUNTRY_OPTIONS.find((entry) => entry.code.toLowerCase() === trimmed);
  if (exactCode) return exactCode.code;
  const exactLabel = CHECKOUT_COUNTRY_OPTIONS.find((entry) => entry.label.toLowerCase() === trimmed);
  return exactLabel?.code ?? null;
}

/**
 * Resolve a typed query to one checkout country: exact code/label first,
 * then a unique partial label/code match (for blur commit).
 */
export function matchCheckoutCountry(query: string): CheckoutCountryCode | null {
  const exact = matchCheckoutCountryExact(query);
  if (exact) return exact;
  const partial = filterCheckoutCountries(query);
  return query.trim() && partial.length === 1 ? partial[0].code : null;
}

/**
 * Countries whose name contains the typed text (plain substring, case and accents ignored), or
 * whose code is the typed text. Everything when nothing is typed.
 */
export function filterCheckoutCountries(query: string): readonly CheckoutCountryOption[] {
  const typed = foldText(query);
  if (!typed) return CHECKOUT_COUNTRY_OPTIONS;
  return CHECKOUT_COUNTRY_OPTIONS.filter(
    (entry) => foldText(entry.label).includes(typed) || entry.code.toLowerCase() === typed,
  );
}

/** Lower case without accents ("Côte d’Ivoire" → "cote d’ivoire"), for search. */
function foldText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}
