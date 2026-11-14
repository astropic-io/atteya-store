/**
 * Which currency a visitor browses in (ATS-313). Pure, with no runtime imports, so
 * `npm run test:cart` can load it with the generated tables.
 *
 * Order: the country from geo headers or the IP lookup, then the browser's time zone,
 * then the Egypt price. Egypt (or `Africa/Cairo`) is EGP at the Egypt price; anywhere else
 * is that place's currency at abroad prices (USD when it has no usable one). What a shopper
 * pays is still decided by the delivery address at checkout.
 */

/** The time zone of a browser in Egypt. */
export const EGYPT_TIME_ZONE = 'Africa/Cairo';

export interface BrowsingCurrencyTables {
  /** ISO country → currency (`COUNTRY_CURRENCY`). */
  readonly countries: Readonly<Record<string, string>>;
  /** IANA time zone → currency (`TZ_CURRENCY`). */
  readonly zones: Readonly<Record<string, string>>;
  /** Currencies whose rate can't be trusted; those show USD instead. */
  readonly isUnreliable: (code: string) => boolean;
}

/** Country → currency. Egypt, and a country that could not be found, get EGP. */
export function currencyForCountry(
  country: string | null | undefined,
  countries: BrowsingCurrencyTables['countries'],
  isUnreliable: BrowsingCurrencyTables['isUnreliable'],
): string {
  if (!country) return 'EGP';
  const iso = country.trim().toUpperCase();
  if (iso === 'EG') return 'EGP';
  return usableOrUsd(countries[iso], isUnreliable);
}

/**
 * Time zone → currency, for a visitor whose country could not be found.
 * `Africa/Cairo` and a missing time zone are EGP (most visitors are in Egypt);
 * any other zone is its currency, or USD when it has no usable one.
 */
export function currencyForTimeZone(
  timeZone: string | null | undefined,
  zones: BrowsingCurrencyTables['zones'],
  isUnreliable: BrowsingCurrencyTables['isUnreliable'],
): string {
  const zone = timeZone?.trim();
  if (!zone || zone === EGYPT_TIME_ZONE) return 'EGP';
  const code = zones[zone];
  if (code === 'EGP') return 'EGP';
  return usableOrUsd(code, isUnreliable);
}

/** The whole browsing order: country when known, else time zone, else EGP. */
export function browsingCurrency(
  country: string | null | undefined,
  timeZone: string | null | undefined,
  tables: BrowsingCurrencyTables,
): string {
  if (country) return currencyForCountry(country, tables.countries, tables.isUnreliable);
  return currencyForTimeZone(timeZone, tables.zones, tables.isUnreliable);
}

function usableOrUsd(code: string | undefined, isUnreliable: (code: string) => boolean): string {
  if (!code || isUnreliable(code)) return 'USD';
  return code;
}
