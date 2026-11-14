/**
 * Where a visitor browses from, and so which prices they see (ATS-313). Pure, with no runtime
 * imports, so `npm run test:cart` can load it with the generated tables.
 *
 * Order: the country from geo headers or the IP lookup, then the country of the browser's time
 * zone, then Egypt. Egypt is EGP at the Egypt price; anywhere else is that country's currency at
 * abroad prices (USD when it has no usable one). What a shopper pays is still decided by the
 * delivery address at checkout.
 */

/** The time zone of a browser in Egypt. */
export const EGYPT_TIME_ZONE = 'Africa/Cairo';

export interface BrowsingTables {
  /** ISO country → currency (`COUNTRY_CURRENCY`). */
  readonly countries: Readonly<Record<string, string>>;
  /** IANA time zone → ISO country (`TZ_COUNTRY`). */
  readonly zones: Readonly<Record<string, string>>;
  /** Currencies whose rate can't be trusted; those show USD instead. */
  readonly isUnreliable: (code: string) => boolean;
}

export interface BrowsingChoice {
  /** ISO country the visitor is taken to be in. Null when nothing tells us. */
  readonly country: string | null;
  /** Display currency. EGP means the Egypt price. */
  readonly currency: string;
}

/** Country → currency. Egypt, and a country that could not be found, get EGP. */
export function currencyForCountry(
  country: string | null | undefined,
  countries: BrowsingTables['countries'],
  isUnreliable: BrowsingTables['isUnreliable'],
): string {
  if (!country) return 'EGP';
  const iso = country.trim().toUpperCase();
  if (iso === 'EG') return 'EGP';
  const code = countries[iso];
  if (!code || isUnreliable(code)) return 'USD';
  return code;
}

/** Time zone → ISO country. `Africa/Cairo` is Egypt; a zone with no country is null. */
export function countryForTimeZone(
  timeZone: string | null | undefined,
  zones: BrowsingTables['zones'],
): string | null {
  const zone = timeZone?.trim();
  if (!zone) return null;
  if (zone === EGYPT_TIME_ZONE) return 'EG';
  return zones[zone] ?? null;
}

/**
 * The whole browsing order: the geo country when known, else the time zone's country, else
 * Egypt. A time zone with no country (for example `Etc/UTC`) is still outside Egypt: USD at
 * abroad prices.
 */
export function browsingChoice(
  geoCountry: string | null | undefined,
  timeZone: string | null | undefined,
  tables: BrowsingTables,
): BrowsingChoice {
  const geo = geoCountry?.trim().toUpperCase() || null;
  if (geo) return { country: geo, currency: currencyForCountry(geo, tables.countries, tables.isUnreliable) };
  if (!timeZone?.trim()) return { country: null, currency: 'EGP' };
  const country = countryForTimeZone(timeZone, tables.zones);
  if (!country) return { country: null, currency: 'USD' };
  return { country, currency: currencyForCountry(country, tables.countries, tables.isUnreliable) };
}
