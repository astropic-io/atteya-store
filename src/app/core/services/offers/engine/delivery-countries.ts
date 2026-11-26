// GENERATED — edit functions/src/offers/engine
/**
 * Where an order can be delivered (ATS-314). Pure: checkout and the order callables share it.
 *
 * - Every country in `DELIVERY_COUNTRY_CODES` can be ordered to.
 * - Egypt is always available and priced by its own boxes and governorates.
 * - Abroad, the countries in `settings/shipping.deliveryCountries` (Settings → Shipping → Abroad →
 *   Delivery Countries) get the abroad box fee plus the country's extra fee
 *   (`settings/shipping.deliveryCountryFees`, ATS-326). Any other country is placed with delivery and the
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
 * Highest extra delivery fee the admin can set for one country abroad (whole EGP, ATS-326).
 * Added to the abroad box fee, the same way a governorate's extra is added in Egypt.
 */
export const MAX_COUNTRY_EXTRA_FEE_EGP = 50_000;

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

/** A country's extra delivery fee for each abroad box (ATS-338), whole EGP, by box id. */
export type CountryBoxFees = Readonly<Partial<Record<CountryFeeBoxId, number>>>;

/** The abroad box ids a country's extra fees are saved under (`ShippingBoxId` in `shipping.ts`). */
export type CountryFeeBoxId = 'box1' | 'box2' | 'box3';

const COUNTRY_FEE_BOX_IDS: readonly CountryFeeBoxId[] = ['box1', 'box2', 'box3'];

function cleanCountryFee(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const fee = Math.round(value);
  return fee < 0 || fee > MAX_COUNTRY_EXTRA_FEE_EGP ? null : fee;
}

/**
 * Saved extra delivery fees per country abroad (`settings/shipping.deliveryCountryFees`), cleaned:
 * known codes only, never Egypt, whole pounds from 0 to `MAX_COUNTRY_EXTRA_FEE_EGP` (rounded first).
 * Each entry is `{ box1, box2, box3 }` (ATS-338); an entry saved as one number before ATS-338
 * (ATS-326) counts as that fee for every box, so old settings keep their prices. An unreadable box
 * fee is left out (that box counts as 0), and a country with none left is dropped. Not a map:
 * nothing saved (every country 0).
 */
export function parseDeliveryCountryFees(raw: unknown): Readonly<Record<string, CountryBoxFees>> {
  const out: Record<string, CountryBoxFees> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const code = key.trim().toUpperCase();
    if (code === EGYPT_COUNTRY_CODE || !isDeliveryCountry(code)) continue;
    const fees: Partial<Record<CountryFeeBoxId, number>> = {};
    if (typeof value === 'number') {
      const fee = cleanCountryFee(value);
      if (fee === null) continue;
      for (const id of COUNTRY_FEE_BOX_IDS) fees[id] = fee;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const id of COUNTRY_FEE_BOX_IDS) {
        const fee = cleanCountryFee((value as Record<string, unknown>)[id]);
        if (fee !== null) fees[id] = fee;
      }
    }
    if (Object.keys(fees).length) out[code] = fees;
  }
  return out;
}

/**
 * The extra delivery fee of a country abroad for one abroad box, added to that box's fee (ATS-326,
 * per box since ATS-338). 0 for Egypt (priced by governorate), for a country with no saved fee for
 * that box, and for one not on the Delivery Countries list (its whole fee is agreed on WhatsApp).
 */
export function countryExtraFee(
  settings: {
    readonly deliveryCountries?: readonly string[] | null;
    readonly deliveryCountryFees?: Readonly<Record<string, CountryBoxFees>> | null;
  },
  country: string,
  boxId: CountryFeeBoxId,
): number {
  if (country === EGYPT_COUNTRY_CODE || !hasSetShippingPrice(settings, country)) return 0;
  const fee = settings.deliveryCountryFees?.[country]?.[boxId];
  if (typeof fee !== 'number' || !Number.isFinite(fee)) return 0;
  return Math.min(MAX_COUNTRY_EXTRA_FEE_EGP, Math.max(0, Math.round(fee)));
}
