// GENERATED — edit functions/src/offers/engine
/**
 * Where an order can be delivered (ATS-314). Pure: checkout and the order callables share it.
 *
 * - Every country in `DELIVERY_COUNTRY_CODES` can be ordered to.
 * - Egypt is always available and priced by its own boxes and governorates.
 * - Abroad, the countries in `settings/shipping.deliveryCountries` (Settings → Shipping → Abroad →
 *   Delivery Countries) get the abroad box fee. Any other country is placed with delivery and the
 *   shipping fee to be agreed with the shopper on WhatsApp (`international-agreed`).
 */

/** Egypt's ISO code. Never in the Delivery Countries list: it is always available. */
export const EGYPT_COUNTRY_CODE = 'EG';

/**
 * Countries with a set shipping price abroad while nothing is saved in `settings/shipping`
 * (the 16 countries checkout offered before ATS-314).
 */
export const DEFAULT_DELIVERY_COUNTRIES: readonly string[] = [
  'AE',
  'AU',
  'BH',
  'CA',
  'DE',
  'ES',
  'FR',
  'GB',
  'IT',
  'JO',
  'KW',
  'NL',
  'OM',
  'QA',
  'SA',
  'US',
];

/** Most countries the Delivery Countries list can hold. */
export const MAX_DELIVERY_COUNTRIES = 250;

/**
 * Every country an order can be delivered to: ISO 3166-1 alpha-2 codes (plus Kosovo, `XK`), the
 * places the CLDR currency table knows, without its non-countries (`EU`, Ascension `AC`, Diego
 * Garcia `DG`, Ceuta `EA`, Canary Islands `IC`, Tristan da Cunha `TA`).
 */
export const DELIVERY_COUNTRY_CODES: readonly string[] = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'XK',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
];

const DELIVERY_COUNTRY_SET: ReadonlySet<string> = new Set(DELIVERY_COUNTRY_CODES);

/** True for a country an order can be delivered to (`EG` included). */
export function isDeliveryCountry(code: string): boolean {
  return DELIVERY_COUNTRY_SET.has(code);
}

/**
 * A saved Delivery Countries list, cleaned: known codes only, never Egypt, no repeats, sorted.
 * Null when the value isn't a list (nothing saved yet: the default list applies). An empty list
 * is a real choice: every country abroad then has its fee agreed on WhatsApp.
 */
export function parseDeliveryCountries(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null;
  const codes = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const code = entry.trim().toUpperCase();
    if (code === EGYPT_COUNTRY_CODE || !isDeliveryCountry(code)) continue;
    codes.add(code);
    if (codes.size >= MAX_DELIVERY_COUNTRIES) break;
  }
  return [...codes].sort();
}

/** The countries abroad with a set shipping price: the saved list, else the default one. */
export function setPriceCountries(settings: {
  readonly deliveryCountries?: readonly string[] | null;
}): readonly string[] {
  return settings.deliveryCountries ?? DEFAULT_DELIVERY_COUNTRIES;
}

/**
 * True when an order to `country` gets a set shipping price: Egypt always, abroad only the
 * countries on the Delivery Countries list. Any other country has its fee agreed on WhatsApp.
 */
export function hasSetShippingPrice(
  settings: { readonly deliveryCountries?: readonly string[] | null },
  country: string,
): boolean {
  if (country === EGYPT_COUNTRY_CODE) return true;
  return setPriceCountries(settings).includes(country);
}
