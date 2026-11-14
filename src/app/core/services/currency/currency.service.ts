import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  DestroyRef,
  inject,
  Injector,
  PLATFORM_ID,
  REQUEST,
  Service,
  signal,
  TransferState,
} from '@angular/core';
import { Router } from '@angular/router';
import * as v from 'valibot';
import { injectFirestore } from '@core/firebase';
import { environment } from '@env/environment';
import { EGP_ENTRY, isUnreliableCurrency, type CurrencyEntry } from '@core/services/offers/engine';
import { SIGNED_IN_HINT_KEY } from '@core/services/auth/signed-in-hint';
import { browsingTarget, isoCountry, preferredCountry, type BrowsingChoice } from './browsing-currency';
import { COUNTRY_CURRENCY } from './country-currency';
import {
  currencyFromCountry,
  normalizeCurrencyCode,
  readTimeZone,
  visitorBrowsingChoice,
  readCachedCurrencyMap,
  readFreshCurrencyMap,
  readRememberedCountry,
  readSavedCountryHint,
  storeCachedCurrencyMap,
  storeRememberedCountry,
  storeSavedCountryHint,
} from './currency-detect';
import { loadPublicCurrency } from './currency-loader';
import type { PublicCurrencyMap } from './currency.schema';
import { CURRENCY_BOOT_KEY, type CurrencyBootTransfer } from './currency.state';
import {
  applyDevLocalGeoFallback,
  countryFromServerVisitorHeader,
  resolveVisitorCountry,
} from './visitor-geo';
import { VisitorLocationResponseSchema } from './visitor-geo.schema';

const PENDING_TIMEOUT_MS = 2500;
const VISITOR_LOCATION_PATH = '/api/visitor-location';
/** Server could not find the country; the browser decides by its time zone (ATS-313). */
const BY_ZONE_ATTR = 'data-cur-by-zone';
/**
 * Prices now differ from the server HTML (ATS-323). Blocks still waiting to hydrate keep the
 * server's prices, so `_base.scss` hides any price that is not marked `data-cur-live`.
 */
const MOVED_ATTR = 'data-cur-moved';

/**
 * Storefront display currency (ATS-317), first known of: `?cur=` (one visit, never saved); the
 * delivery country the shopper last told us in this browser (checkout pick or Account address,
 * 30 days); a signed-in shopper's saved address country; the guess from visitor geo (CDN headers
 * or IP lookup), then the browser's time zone, then EGP (ATS-313).
 * Egypt stays on EGP and keeps the domestic shipping banner.
 */
@Service()
export class CurrencyService {
  readonly #platformId = inject(PLATFORM_ID);
  readonly #document = inject(DOCUMENT);
  readonly #router = inject(Router);
  readonly #firestore = injectFirestore();
  readonly #destroyRef = inject(DestroyRef);
  readonly #injector = inject(Injector);
  readonly #transfer = inject(TransferState);
  readonly #request = inject(REQUEST, { optional: true });

  readonly #selected = signal('EGP');
  readonly #entry = signal<CurrencyEntry>(EGP_ENTRY);
  readonly #ready = signal(false);
  readonly #visitorCountry = signal<string | null>(null);

  readonly selected = this.#selected.asReadonly();
  readonly entry = this.#entry.asReadonly();
  readonly ready = this.#ready.asReadonly();
  /** ISO country from CDN/IP geo (AS-21). Null until resolved or when unknown. */
  readonly visitorCountry = this.#visitorCountry.asReadonly();

  #map: PublicCurrencyMap | null = null;
  #loading: Promise<PublicCurrencyMap | null> | null = null;
  #generation = 0;
  #settled = false;
  #timer: number | undefined;
  /** `?cur=` of this visit (ATS-317: beats everything). */
  #queryCode: string | null = null;
  /** The guess from geo and time zone; null until worked out in the browser. */
  #guess: BrowsingChoice | null = null;
  #booted = false;
  /** The currency the last settled render was asked for (a fallback may show USD or EGP instead). */
  #settledFor: string | null = null;
  #bootTransfer: CurrencyBootTransfer | null = null;
  #guessing: Promise<void> | null = null;
  /** Signed-in account and its saved address country (`setAccount`); first from the stored hint. */
  #uid: string | null = null;
  #savedCountry: string | null = null;
  /** The currency in the server HTML this page hydrated (ATS-323); null without a server render. */
  #renderedCode: string | null = null;

  constructor() {
    if (isPlatformBrowser(this.#platformId)) {
      this.#readAccountHint();
      this.#hydrateFromTransfer();
    }
    afterNextRender(() => {
      void this.#bootClient();
    });
    this.#destroyRef.onDestroy(() => this.#clearTimer());
  }

  /**
   * Checkout only (ATS-309): the currency an order shipped to `country` is shown and priced in,
   * whatever the visitor browsed in. Egypt is EGP. Abroad it is the delivery country's currency
   * (`currencyFromCountry()`, USD for a country without a usable one), never EGP: null while the
   * factors can't be read, so checkout shows no amount rather than the Egypt price. Not saved,
   * and it never changes `entry()`. Reads the factors fresh, not the day-old cached copy (ATS-311),
   * so checkout shows the amounts the server works out (it refuses an order that would cost more).
   */
  async entryForDeliveryCountry(country: string): Promise<CurrencyEntry | null> {
    const code = currencyFromCountry(country);
    if (code === 'EGP') return EGP_ENTRY;
    const map = (await this.#loadFreshMap()) ?? (await this.#loadMap());
    if (!map) return null;
    // Same rule as the server's `payInEntry()`: a factor above 0, else USD.
    const usable = (entry: CurrencyEntry | null) => (entry && entry.factor > 0 ? entry : null);
    return usable(factorsEntry(code, map)) ?? usable(factorsEntry('USD', map));
  }

  /**
   * ATS-317: the signed-in account (null when signed out) and the country of its saved address
   * (null when it has none). Browsing prices follow it when this browser remembers no later choice.
   */
  setAccount(uid: string | null, savedCountry: string | null | undefined): void {
    if (!isPlatformBrowser(this.#platformId)) return;
    // `undefined`: the read failed, so keep what was last seen for this same account.
    const kept = uid !== null && uid === this.#uid ? this.#savedCountry : null;
    const country = savedCountry === undefined ? kept : isoCountry(savedCountry);
    this.#uid = uid;
    this.#savedCountry = uid ? country : null;
    storeSavedCountryHint(uid ? { uid, country: this.#savedCountry } : null);
    void this.#reconcile();
  }

  /** ATS-317: the shopper picked this delivery country at checkout; browsing prices follow it. */
  rememberCheckoutCountry(country: string): void {
    const iso = isoCountry(country);
    if (!isPlatformBrowser(this.#platformId) || !iso) return;
    storeRememberedCountry(iso, this.#uid);
    void this.#reconcile();
  }

  /** ATS-317: the shopper saved an address in this country (Account, or the first order). */
  rememberSavedAddressCountry(uid: string, country: string): void {
    const iso = isoCountry(country);
    if (!isPlatformBrowser(this.#platformId) || !iso) return;
    storeRememberedCountry(iso, uid);
    if (uid === this.#uid) {
      this.#savedCountry = iso;
      storeSavedCountryHint({ uid, country: iso });
    }
    void this.#reconcile();
  }

  /** Runs during SSR before the storefront HTML is rendered. */
  async prepareForServerRender(): Promise<void> {
    this.#resetForRequest();
    const fromQuery = normalizeCurrencyCode(this.#queryCur());
    if (fromQuery) {
      await this.#finishWithCode(fromQuery, null, { pendingIntl: fromQuery !== 'EGP' });
      this.#publishTransfer(fromQuery);
      return;
    }
    const headers = this.#request?.headers ?? null;
    const preset = headers ? countryFromServerVisitorHeader(headers) : null;
    const resolved = preset ?? (headers ? await resolveVisitorCountry(headers) : null);
    const country = applyDevLocalGeoFallback(resolved, !environment.production);
    this.#visitorCountry.set(country);
    if (country === null) {
      // Unknown country (ATS-313): render EGP with prices hidden; the browser decides by time zone.
      this.#apply(EGP_ENTRY);
      this.#syncDocumentHints(null, false, true);
      // Prerendered pages have no visitor: the browser hydrates this same ready EGP render
      // (so the chrome is kept), then runs the full lookup.
      if (!headers) {
        const payload: CurrencyBootTransfer = {
          country: null,
          code: null,
          map: null,
          prerendered: true,
        };
        this.#transfer.set(CURRENCY_BOOT_KEY, payload);
        return;
      }
      // The inline script in index.html shows these EGP prices at once for an Africa/Cairo browser.
      this.#document.documentElement.setAttribute(BY_ZONE_ATTR, '');
      // Factors ride along, so a visitor the time zone places abroad converts without a read.
      const map = await this.#loadMap();
      this.#transfer.set(CURRENCY_BOOT_KEY, { country: null, code: null, map });
      return;
    }
    const code = currencyFromCountry(country);
    await this.#finishWithCode(code, country, { pendingIntl: code !== 'EGP' });
    this.#publishTransfer(code);
  }

  /** Each SSR request gets a fresh currency resolution (Cloud Run reuses the process). */
  #resetForRequest(): void {
    this.#generation += 1;
    this.#settled = false;
    this.#ready.set(false);
    this.#clearTimer();
  }

  async #bootClient(): Promise<void> {
    this.#queryCode = normalizeCurrencyCode(this.#queryCur());
    this.#stripCurParam();
    const transferred = this.#transfer.get(CURRENCY_BOOT_KEY, null);
    this.#transfer.remove(CURRENCY_BOOT_KEY);
    if (transferred?.map) this.#map ??= transferred.map;
    this.#bootTransfer = transferred;
    this.#booted = true;
    // `?cur=` or a country the shopper told us needs no guess (and no lookup): shown straight away.
    await this.#reconcile();
  }

  /** The browsing guess (ATS-313): what the server found, else geo in the browser, else time zone. */
  async #resolveGuess(transferred: CurrencyBootTransfer | null): Promise<BrowsingChoice> {
    if (transferred && !transferred.prerendered) {
      // The server already tried every lookup; go straight to the time zone.
      if (transferred.code === null) return visitorBrowsingChoice(null, readTimeZone());
      // A country from the server: keep what it rendered (EGP when its factors failed to load).
      if (transferred.country !== null) return { country: transferred.country, currency: transferred.code };
    }
    // Prerendered, a `?cur=` render, or SSR without geo (App Hosting has no CDN country headers).
    const geo = await this.#resolveVisitorCountryClient();
    return visitorBrowsingChoice(geo, readTimeZone());
  }

  /** The currency browsing should show now (ATS-317); null while nothing is known yet. */
  #target(): BrowsingChoice | null {
    return browsingTarget(this.#queryCode, this.#preferredCountry(), this.#guess, {
      countries: COUNTRY_CURRENCY,
      isUnreliable: isUnreliableCurrency,
    });
  }

  #preferredCountry(): string | null {
    return preferredCountry({
      remembered: readRememberedCountry(),
      uid: this.#uid,
      savedCountry: this.#savedCountry,
      now: Date.now(),
    });
  }

  /** Moves the prices to `#target()` when it differs from what is shown. */
  async #reconcile(): Promise<void> {
    if (!this.#booted) return;
    let target = this.#target();
    if (!target) {
      // Only now is the guess needed (geo lookup or time zone); worked out once per visit.
      this.#guessing ??= this.#resolveGuess(this.#bootTransfer).then((guess) => {
        this.#guess = guess;
      });
      await this.#guessing;
      target = this.#target();
      if (!target) return;
    }
    if (target.country !== null || this.#queryCode === null) this.#visitorCountry.set(target.country);
    if (this.#settled && this.#settledFor === target.currency) {
      this.#syncDocumentHints(this.#visitorCountry(), true, false);
      return;
    }
    this.#settled = false;
    await this.#finishWithCode(target.currency, target.country, {
      pendingIntl: target.currency !== 'EGP',
    });
  }

  /** The signed-in account last seen in this browser, until `setAccount` brings the real one. */
  #readAccountHint(): void {
    try {
      if (localStorage.getItem(SIGNED_IN_HINT_KEY) !== '1') return;
    } catch {
      return;
    }
    const hint = readSavedCountryHint();
    this.#uid = hint?.uid ?? null;
    this.#savedCountry = hint?.country ?? null;
  }

  /**
   * True when the shopper told us a country whose prices differ from the server's (ATS-317): the
   * early script in `index.html` hid the prices and they stay hidden until the right ones are ready.
   */
  #preferenceDiffers(serverCode: string | null): boolean {
    if (this.#hasQueryInAddress()) return false;
    const preferred = this.#preferredCountry();
    return preferred !== null && currencyFromCountry(preferred) !== serverCode;
  }

  #hasQueryInAddress(): boolean {
    try {
      return new URLSearchParams(this.#document.location?.search ?? '').has('cur');
    } catch {
      return false;
    }
  }

  #hydrateFromTransfer(): void {
    const transferred = this.#transfer.get(CURRENCY_BOOT_KEY, null);
    if (!transferred) return;
    this.#renderedCode = transferred.code ?? 'EGP';
    this.#visitorCountry.set(transferred.country);
    if (transferred.map) this.#map = transferred.map;
    if (transferred.code === null) {
      // Match the server's hidden EGP render; `#bootClient` decides by time zone.
      this.#apply(EGP_ENTRY);
      return;
    }
    const differs = this.#preferenceDiffers(transferred.code);
    this.#settledFor = transferred.code;
    if (transferred.code === 'EGP') {
      this.#apply(EGP_ENTRY);
      this.#settled = !differs;
      this.#syncDocumentHints(this.#visitorCountry(), !differs, differs);
      return;
    }
    if (this.#map) {
      // Same prices as the server HTML, so hydration matches; `#bootClient` moves to the right ones.
      this.#apply(entryFor(transferred.code, this.#map));
      this.#settled = !differs;
      this.#syncDocumentHints(this.#visitorCountry(), !differs, differs);
    }
  }

  #publishTransfer(code: string): void {
    const payload: CurrencyBootTransfer = {
      country: this.#visitorCountry(),
      code: this.#selected(),
      map: code === 'EGP' ? null : this.#map,
    };
    this.#transfer.set(CURRENCY_BOOT_KEY, payload);
  }

  async #finishWithCode(
    code: string,
    country: string | null,
    options: { pendingIntl: boolean },
  ): Promise<void> {
    this.#clearTimer();
    this.#settledFor = code;
    if (country !== null) this.#visitorCountry.set(country);
    if (code === 'EGP') {
      const generation = ++this.#generation;
      this.#apply(EGP_ENTRY);
      this.#settled = true;
      if (this.#pricesHidden()) {
        this.#revealAfterRender(generation);
        return;
      }
      this.#syncDocumentHints(this.#visitorCountry(), true, false);
      return;
    }
    if (options.pendingIntl) {
      this.#syncDocumentHints(this.#visitorCountry(), false, true);
    }
    if (isPlatformBrowser(this.#platformId)) {
      this.#timer = window.setTimeout(() => this.#giveUp(), PENDING_TIMEOUT_MS);
    }
    const generation = ++this.#generation;
    const map = await this.#loadMap();
    if (generation !== this.#generation || this.#settled) return;
    this.#clearTimer();
    if (!map) {
      this.#giveUp();
      return;
    }
    this.#map = map;
    const entry = entryFor(code, map);
    this.#apply(entry);
    this.#settled = true;
    if (this.#pricesHidden()) {
      this.#revealAfterRender(generation);
      return;
    }
    this.#syncDocumentHints(this.#visitorCountry(), true, false);
  }

  /** In the browser, prices are hidden (`data-cur-pending`) while the currency resolves. */
  #pricesHidden(): boolean {
    return (
      isPlatformBrowser(this.#platformId) && this.#document.documentElement.hasAttribute('data-cur-pending')
    );
  }

  /**
   * Shows the prices only once Angular has drawn the new currency (ATS-321 time zone, ATS-323 a
   * remembered country), so the price the server rendered never shows for a frame.
   */
  #revealAfterRender(generation: number): void {
    afterNextRender(
      () => {
        if (generation === this.#generation && this.#settled) {
          this.#syncDocumentHints(this.#visitorCountry(), true, false);
        }
      },
      { injector: this.#injector },
    );
  }

  async #resolveVisitorCountryClient(): Promise<string | null> {
    try {
      const response = await fetch(VISITOR_LOCATION_PATH, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const parsed = v.safeParse(VisitorLocationResponseSchema, await response.json());
      if (!parsed.success) return null;
      return applyDevLocalGeoFallback(parsed.output.country, !environment.production);
    } catch {
      return null;
    }
  }

  #queryCur(): string | null {
    let current: unknown = this.#router.routerState.snapshot.root;
    let value: unknown;
    while (isRouteNode(current)) {
      value = current.queryParams['cur'] ?? value;
      current = current.firstChild;
    }
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return null;
  }

  #stripCurParam(): void {
    const url = this.#router.parseUrl(this.#router.url);
    if (!('cur' in url.queryParams)) return;
    delete url.queryParams['cur'];
    void this.#router.navigateByUrl(url, { replaceUrl: true });
  }

  /** One read of `settings/currency` past the caches (checkout only); null when it fails. */
  async #loadFreshMap(): Promise<PublicCurrencyMap | null> {
    if (!isPlatformBrowser(this.#platformId)) return null;
    const loaded = await loadPublicCurrency(this.#firestore);
    if (!loaded || Object.keys(loaded).length === 0) return null;
    storeCachedCurrencyMap(loaded);
    return loaded;
  }

  async #loadMap(): Promise<PublicCurrencyMap | null> {
    const fresh = this.#map ?? (isPlatformBrowser(this.#platformId) ? readFreshCurrencyMap() : null);
    if (fresh) {
      this.#map = fresh;
      return fresh;
    }
    try {
      this.#loading ??= loadPublicCurrency(this.#firestore);
      const loaded = await this.#loading;
      if (loaded && Object.keys(loaded).length > 0) {
        this.#map = loaded;
        if (isPlatformBrowser(this.#platformId)) {
          storeCachedCurrencyMap(loaded);
        }
        return loaded;
      }
    } catch {
      // A failed chunk or network read falls through to the last cached factors.
    } finally {
      this.#loading = null;
    }
    if (isPlatformBrowser(this.#platformId)) {
      const stale = readCachedCurrencyMap(null);
      if (stale) this.#map = stale;
      return stale;
    }
    return null;
  }

  #apply(entry: CurrencyEntry): void {
    this.#selected.set(entry.code);
    this.#entry.set(entry);
    this.#ready.set(true);
  }

  #giveUp(): void {
    if (this.#settled) return;
    const generation = ++this.#generation;
    this.#settled = true;
    console.warn('Currency rates took too long. Showing EGP prices.');
    this.#apply(EGP_ENTRY);
    if (this.#pricesHidden()) {
      this.#revealAfterRender(generation);
      return;
    }
    this.#syncDocumentHints(this.#visitorCountry(), true, false);
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    window.clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #syncDocumentHints(country: string | null, ready: boolean, pendingIntl: boolean): void {
    const root = this.#document.documentElement;
    if (country) root.setAttribute('data-visitor-country', country);
    else root.removeAttribute('data-visitor-country');
    if (ready) root.setAttribute('data-currency-ready', '');
    else root.removeAttribute('data-currency-ready');
    if (pendingIntl) root.setAttribute('data-cur-pending', '');
    else root.removeAttribute('data-cur-pending');
    if (ready) root.removeAttribute(BY_ZONE_ATTR);
    const moved =
      ready && !pendingIntl && this.#renderedCode !== null && this.#selected() !== this.#renderedCode;
    if (moved) root.setAttribute(MOVED_ATTR, '');
    else root.removeAttribute(MOVED_ATTR);
  }
}

function entryFor(code: string, map: PublicCurrencyMap): CurrencyEntry {
  const chosen = factorsEntry(code, map) ?? factorsEntry('USD', map);
  return chosen ?? EGP_ENTRY;
}

function factorsEntry(code: string, map: PublicCurrencyMap): CurrencyEntry | null {
  const factors = map[code];
  if (!factors) return null;
  return factors.shippingFactor === undefined
    ? { code, factor: factors.factor }
    : { code, factor: factors.factor, shippingFactor: factors.shippingFactor };
}

interface RouteNode {
  readonly queryParams: Record<string, unknown>;
  readonly firstChild: unknown;
}

function isRouteNode(value: unknown): value is RouteNode {
  return typeof value === 'object' && value !== null && 'queryParams' in value;
}
