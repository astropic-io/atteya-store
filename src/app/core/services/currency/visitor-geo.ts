import * as v from 'valibot';
import { CountryIsSchema, IpWhoCountrySchema } from './visitor-geo.schema';

const ISO_COUNTRY = /^[A-Z]{2}$/;

/** Set on the Express request by server middleware before SSR (not from clients). */
export const VISITOR_COUNTRY_HEADER = 'x-atteya-visitor-country';

const HEADER_COUNTRY = [
  'cf-ipcountry',
  'x-country-code',
  'cloudfront-viewer-country',
  'x-appengine-country',
  'fastly-client-country',
  'x-vercel-ip-country',
] as const;

/** One lookup service call. */
const GEO_ATTEMPT_MS = 900;
/** All lookups for one visitor together, so a page never waits long on them. */
const GEO_BUDGET_MS = 2000;
/** A found country is kept per IP for a few hours (ATS-313). */
const GEO_CACHE_MS = 6 * 60 * 60 * 1000;
/** A failed lookup is kept briefly, so one page view never runs all the lookups twice. */
const GEO_MISS_CACHE_MS = 60 * 1000;
const GEO_CACHE_MAX = 5000;

/** Drops a client-sent country hint; only middleware may set {@link VISITOR_COUNTRY_HEADER}. */
export function stripUntrustedVisitorCountry(headers: Headers): Headers {
  if (!headers.has(VISITOR_COUNTRY_HEADER)) return headers;
  const stripped = new Headers(headers);
  stripped.delete(VISITOR_COUNTRY_HEADER);
  return stripped;
}

/** Server-only country stamped by Express before SSR (never from clients). */
export function countryFromServerVisitorHeader(headers: Headers): string | null {
  return normalizeCountry(headers.get(VISITOR_COUNTRY_HEADER));
}

/**
 * Reads an ISO country from CDN or platform geo headers when present.
 * `X-Client-Geo-Location` uses `country=XX` (Google front ends).
 */
export function countryFromGeoHeaders(headers: Headers): string | null {
  for (const name of HEADER_COUNTRY) {
    const parsed = normalizeCountry(headers.get(name));
    if (parsed) return parsed;
  }
  const clientGeo = headers.get('x-client-geo-location');
  if (clientGeo) {
    const match = /(?:^|,|\s)country=([A-Za-z]{2})(?:,|$|\s)/i.exec(clientGeo);
    if (match) {
      const parsed = normalizeCountry(match[1]);
      if (parsed) return parsed;
    }
  }
  return null;
}

/**
 * Ensures geo resolution can use the visitor IP on App Hosting, where CDN geo
 * headers are absent and the socket may be the only hint before `X-Forwarded-For`.
 */
export function enrichHeadersForVisitorGeo(
  headers: Headers,
  remoteAddress: string | null | undefined,
): Headers {
  if (clientIpFromHeaders(headers)) return headers;
  const ip = normalizeIp(remoteAddress?.trim() ?? '');
  if (!ip || isPrivateIp(ip)) return headers;
  const enriched = new Headers(headers);
  enriched.set('x-forwarded-for', ip);
  return enriched;
}

/** First public client IP from forwarded headers or the socket address. */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    for (const part of forwarded.split(',')) {
      const ip = normalizeIp(part.trim());
      if (ip && !isPrivateIp(ip)) return ip;
    }
  }
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    const ip = normalizeIp(realIp.trim());
    if (ip && !isPrivateIp(ip)) return ip;
  }
  return null;
}

/**
 * Header geo first, then a short IP lookup when a public address is known.
 * Used on SSR and on `/api/visitor-location` for client-rendered routes.
 */
export async function resolveVisitorCountry(
  headers: Headers,
  remoteAddress?: string | null,
): Promise<string | null> {
  const withoutSpoof = stripUntrustedVisitorCountry(headers);
  const enriched = enrichHeadersForVisitorGeo(withoutSpoof, remoteAddress);
  const fromHeader = countryFromGeoHeaders(enriched);
  if (fromHeader) return fromHeader;
  const ip = clientIpFromHeaders(enriched);
  if (!ip) {
    if (remoteAddress !== undefined && enriched.has('x-forwarded-for')) {
      console.warn('Visitor country lookup skipped: no public IP in X-Forwarded-For');
    }
    return null;
  }
  return lookupCountryByIp(ip);
}

/** Non-production only: localhost/private IP geo → Egypt (store home market). */
export function applyDevLocalGeoFallback(country: string | null, devFallback: boolean): string | null {
  if (country !== null || !devFallback) return country;
  return 'EG';
}

export function headersFromRecord(record: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (code === 'XX' || code === 'T1') return null;
  return ISO_COUNTRY.test(code) ? code : null;
}

function normalizeIp(raw: string): string | null {
  if (!raw) return null;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : null;
  }
  if (raw.includes(':') && raw.includes('.')) {
    const last = raw.lastIndexOf(':');
    return raw.slice(0, last);
  }
  return raw;
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

interface CachedCountry {
  readonly country: string | null;
  readonly expiresAt: number;
}

const countryByIp = new Map<string, CachedCountry>();

/**
 * IP → country (ATS-313): `ipwho.is`, one quick retry when it failed fast (not after a
 * timeout), then `api.country.is`. All within {@link GEO_BUDGET_MS}. Found countries are
 * cached per IP for a few hours; a miss for a minute. Each failure logs
 * `Visitor country lookup failed` with the reason.
 */
async function lookupCountryByIp(ip: string): Promise<string | null> {
  const now = Date.now();
  const cached = countryByIp.get(ip);
  if (cached && cached.expiresAt > now) return cached.country;
  if (cached) countryByIp.delete(ip);

  const deadline = now + GEO_BUDGET_MS;
  const first = await attemptLookup(ipWhoIs, ip, deadline);
  let country = first.country;
  if (!country && !first.timedOut) country = (await attemptLookup(ipWhoIs, ip, deadline)).country;
  if (!country) country = (await attemptLookup(countryIs, ip, deadline)).country;

  rememberCountry(ip, country);
  return country;
}

function rememberCountry(ip: string, country: string | null): void {
  if (countryByIp.size >= GEO_CACHE_MAX) {
    const oldest = countryByIp.keys().next();
    if (!oldest.done) countryByIp.delete(oldest.value);
  }
  const ttl = country ? GEO_CACHE_MS : GEO_MISS_CACHE_MS;
  countryByIp.set(ip, { country, expiresAt: Date.now() + ttl });
}

interface LookupService {
  readonly name: string;
  readonly url: (ip: string) => string;
  readonly read: (body: unknown) => string | null;
}

const ipWhoIs: LookupService = {
  name: 'ipwho.is',
  url: (ip) => `https://ipwho.is/${encodeURIComponent(ip)}`,
  read: (body) => {
    const parsed = v.safeParse(IpWhoCountrySchema, body);
    return parsed.success ? parsed.output.country_code : null;
  },
};

const countryIs: LookupService = {
  name: 'country.is',
  url: (ip) => `https://api.country.is/${encodeURIComponent(ip)}`,
  read: (body) => {
    const parsed = v.safeParse(CountryIsSchema, body);
    return parsed.success ? parsed.output.country : null;
  },
};

async function attemptLookup(
  service: LookupService,
  ip: string,
  deadline: number,
): Promise<{ country: string | null; timedOut: boolean }> {
  const remaining = Math.min(GEO_ATTEMPT_MS, deadline - Date.now());
  if (remaining <= 0) {
    console.warn(`Visitor country lookup failed: no time left for ${service.name}`);
    return { country: null, timedOut: true };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(service.url(ip), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn(`Visitor country lookup failed: ${service.name} answered ${response.status}`);
      return { country: null, timedOut: false };
    }
    const body: unknown = await response.json();
    const country = normalizeCountry(service.read(body));
    if (!country) {
      console.warn(
        `Visitor country lookup failed: unexpected ${service.name} answer`,
        JSON.stringify(body).slice(0, 300),
      );
    }
    return { country, timedOut: false };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    console.warn(
      `Visitor country lookup failed (${service.name}):`,
      timedOut ? 'timed out' : error instanceof Error ? error.message : error,
    );
    return { country: null, timedOut };
  } finally {
    clearTimeout(timer);
  }
}
