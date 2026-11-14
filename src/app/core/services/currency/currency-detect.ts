import * as v from 'valibot';
import { isUnreliableCurrency } from '@core/services/offers/engine';
import {
  browsingChoice,
  currencyForCountry,
  EGYPT_TIME_ZONE,
  type BrowsingChoice,
} from './browsing-currency';
import { COUNTRY_CURRENCY } from './country-currency';
import type { PublicCurrencyMap } from './currency.schema';

const cachedFactorsSchema = v.object({
  factor: v.pipe(v.number(), v.finite(), v.gtValue(0)),
  shippingFactor: v.optional(v.pipe(v.number(), v.finite(), v.gtValue(0))),
});

const CachedCurrencySchema = v.object({
  savedAt: v.pipe(v.number(), v.finite()),
  currencies: v.record(v.string(), cachedFactorsSchema),
});

// v2 (ATS-311): entries carry `shippingFactor`; a cache saved before it is never read, so checkout
// and the server convert the shipping fee with the same rate.
const STORED_DOC_KEY = 'atteya.curDoc.v2';
const DOC_TTL_MS = 24 * 60 * 60 * 1000;
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** `?cur=` test override. EGP or any 3-letter code. Never stored. */
export function normalizeCurrencyCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (code === 'EGP') return code;
  return CURRENCY_CODE.test(code) ? code : null;
}

export function readTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz !== 'string') return undefined;
    const trimmed = tz.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * ISO country → display currency from CLDR tender data.
 * Egypt, and a visitor whose country could not be found, get EGP.
 * Unknown or unreliable currency codes become USD.
 */
export function currencyFromCountry(country: string | null | undefined): string {
  return currencyForCountry(country, COUNTRY_CURRENCY, isUnreliableCurrency);
}

/**
 * Where the visitor browses from and in which currency (ATS-313): the geo country when known,
 * else the country of the browser's time zone (`Africa/Cairo` is Egypt), else Egypt.
 * The zone table is loaded only when the geo country is unknown; if it can't load, Egypt.
 */
export async function visitorBrowsingChoice(
  geoCountry: string | null,
  timeZone: string | undefined,
): Promise<BrowsingChoice> {
  const tables = { countries: COUNTRY_CURRENCY, isUnreliable: isUnreliableCurrency };
  if (geoCountry || !timeZone || timeZone === EGYPT_TIME_ZONE) {
    return browsingChoice(geoCountry, timeZone, { ...tables, zones: {} });
  }
  try {
    const { TZ_COUNTRY } = await import('./tz-country');
    return browsingChoice(null, timeZone, { ...tables, zones: TZ_COUNTRY });
  } catch {
    // Page code missing after a release: show the Egypt price; checkout corrects it by address.
    return { country: null, currency: 'EGP' };
  }
}

export function readCachedCurrencyMap(maxAgeMs: number | null): PublicCurrencyMap | null {
  try {
    const raw = localStorage.getItem(STORED_DOC_KEY);
    if (!raw) return null;
    const parsed = v.safeParse(CachedCurrencySchema, JSON.parse(raw) as unknown);
    if (!parsed.success) return null;
    if (maxAgeMs !== null && Date.now() - parsed.output.savedAt > maxAgeMs) return null;
    return parsed.output.currencies;
  } catch {
    return null;
  }
}

export function readFreshCurrencyMap(): PublicCurrencyMap | null {
  return readCachedCurrencyMap(DOC_TTL_MS);
}

export function storeCachedCurrencyMap(currencies: PublicCurrencyMap): void {
  try {
    localStorage.setItem(STORED_DOC_KEY, JSON.stringify({ savedAt: Date.now(), currencies }));
  } catch {
    // A failed cache write only costs a network read next time.
  }
}
