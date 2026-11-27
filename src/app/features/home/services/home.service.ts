import { isPlatformBrowser } from '@angular/common';
import { computed, DestroyRef, inject, PLATFORM_ID, Service, signal, TransferState } from '@angular/core';
import * as v from 'valibot';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { injectFirestore } from '@core/firebase';
import { createValibotConverter } from '@shared/utils/firebase/firestore-converter';
import {
  HomeHelpBoxSchema,
  HomeHeroSchema,
  HomeNavListSchema,
  HomeOfferBannerSchema,
  HomeSettingsSchema,
  HomeShopCategoriesSchema,
} from '../schemas/home.schema';
import { HOME_SETTINGS_KEY, HomeSettingsSeed, toHomeSettingsSeed } from '../resolvers/home-settings.state';
import {
  HomeHelpBox,
  HomeHero,
  HomeNavList,
  HomeOfferBanner,
  HomeSettings,
  HomeShopCategories,
} from '../models/home.model';
import {
  DEFAULT_HOME_HELP_BOX,
  DEFAULT_HOME_HERO,
  DEFAULT_HOME_NAV_LIST,
  DEFAULT_HOME_OFFER_BANNER,
  DEFAULT_HOME_SHOP_CATEGORIES,
} from '../data/home.data';
import {
  heroWithoutDeleted,
  navListWithoutDeleted,
  shopCardsWithoutDeleted,
} from '../utils/home-defaults.utils';
import { CatalogService } from '@core/services/products/catalog.service';
import { NavService } from '@core/services/navigation/nav.service';
import { STORE_INFO, whatsappChatUrl } from '@core/config/store-info';
import { OffersService } from '@core/services/offers/offers.service';
import { canShopOffer } from '@core/services/offers/offer-shop';
import {
  heroWithTargets,
  navListWithTargets,
  offerBannerForStore,
  shopCardsWithTargets,
} from '../utils/home-link-targets.utils';

const HERO_STORAGE_KEY = 'atteya_store_home_hero';
const SHOP_CATEGORIES_STORAGE_KEY = 'atteya_store_home_shop_categories';
const NAV_LIST_STORAGE_KEY = 'atteya_store_home_nav_list';
const OFFER_BANNER_STORAGE_KEY = 'atteya_store_home_offer_banner';
const HELP_BOX_STORAGE_KEY = 'atteya_store_home_help_box';

/**
 * A saved Previous Versions copy of `settings/home` (ATS-251) through today's schema, with the
 * built-in sections standing in for missing ones; null when it no longer fits.
 */
export function homeSettingsFromVersion(data: unknown): HomeSettingsUpdate | null {
  const parsed = v.safeParse(HomeSettingsSchema, data);
  if (!parsed.success) return null;
  return {
    hero: parsed.output.hero,
    shopCategories: parsed.output.shopCategories ?? DEFAULT_HOME_SHOP_CATEGORIES,
    navList: parsed.output.navList ?? DEFAULT_HOME_NAV_LIST,
    offerBanner: parsed.output.offerBanner ?? DEFAULT_HOME_OFFER_BANNER,
    helpBox: parsed.output.helpBox ?? DEFAULT_HOME_HELP_BOX,
  };
}

export interface HomeSettingsUpdate {
  readonly hero: HomeHero;
  readonly shopCategories: HomeShopCategories;
  readonly navList: HomeNavList;
  readonly offerBanner: HomeOfferBanner;
  readonly helpBox: HomeHelpBox;
}

/**
 * Reads one saved copy and checks it against its schema. A copy that is
 * missing, unreadable or no longer matches is dropped (and removed), so an
 * old or broken copy never reaches the page.
 */
function readStored<TSchema extends v.GenericSchema>(
  key: string,
  schema: TSchema,
): v.InferOutput<TSchema> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const result = v.safeParse(schema, JSON.parse(raw));
    if (result.success) return result.output;
  } catch {
    // Unreadable copy: fall through and remove it.
  }
  removeStored(key);
  return null;
}

function persistStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or blocked storage.
  }
}

function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing to remove.
  }
}

/**
 * Saves the sections the live document has, for the next visit, and drops a
 * saved section the document no longer has (the built-in one is right then).
 */
function persistStoredSettings(settings: HomeSettingsSeed | null): void {
  if (settings) persistStored(HERO_STORAGE_KEY, settings.hero);
  else removeStored(HERO_STORAGE_KEY);
  if (settings?.shopCategories) persistStored(SHOP_CATEGORIES_STORAGE_KEY, settings.shopCategories);
  else removeStored(SHOP_CATEGORIES_STORAGE_KEY);
  if (settings?.navList) persistStored(NAV_LIST_STORAGE_KEY, settings.navList);
  else removeStored(NAV_LIST_STORAGE_KEY);
  if (settings?.offerBanner) persistStored(OFFER_BANNER_STORAGE_KEY, settings.offerBanner);
  else removeStored(OFFER_BANNER_STORAGE_KEY);
  if (settings?.helpBox) persistStored(HELP_BOX_STORAGE_KEY, settings.helpBox);
  else removeStored(HELP_BOX_STORAGE_KEY);
}

/** How long a client navigation to `/` waits for settings/home before showing the built-in sections. */
const FIRST_SNAPSHOT_WAIT_MS = 3000;

@Service()
export class HomeService {
  readonly #firestore = injectFirestore();

  readonly #homeDocRef = doc(this.#firestore, 'settings', 'home').withConverter(
    createValibotConverter(HomeSettingsSchema),
  );

  readonly #transfer = inject(TransferState);
  readonly #destroyRef = inject(DestroyRef);
  readonly #catalog = inject(CatalogService);
  readonly #nav = inject(NavService);
  readonly #offers = inject(OffersService);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** undefined while the first browser snapshot is still outstanding. */
  readonly #homeDoc = signal<HomeSettingsSeed | null | undefined>(undefined);

  /**
   * Copies saved on an earlier visit, read and checked once in the browser.
   * Left empty when the server sent its own seed (even an empty one), so
   * hydration always matches the server HTML.
   */
  #storedHero: HomeHero | null = null;
  #storedShopCategories: HomeShopCategories | null = null;
  #storedNavList: HomeNavList | null = null;
  #storedOfferBanner: HomeOfferBanner | null = null;
  #storedHelpBox: HomeHelpBox | null = null;

  #markFirstAnswer: () => void = () => undefined;
  readonly #firstAnswer = new Promise<void>((resolve) => (this.#markFirstAnswer = resolve));

  constructor() {
    if (this.#transfer.hasKey(HOME_SETTINGS_KEY)) {
      this.#homeDoc.set(this.#transfer.get(HOME_SETTINGS_KEY, null));
      // Leave the key on the server so it is written into the HTML.
      if (this.#isBrowser) this.#transfer.remove(HOME_SETTINGS_KEY);
    } else if (!this.#isBrowser) {
      this.#homeDoc.set(null);
    } else {
      this.#storedHero = readStored(HERO_STORAGE_KEY, HomeHeroSchema);
      this.#storedShopCategories = readStored(SHOP_CATEGORIES_STORAGE_KEY, HomeShopCategoriesSchema);
      this.#storedNavList = readStored(NAV_LIST_STORAGE_KEY, HomeNavListSchema);
      this.#storedOfferBanner = readStored(OFFER_BANNER_STORAGE_KEY, HomeOfferBannerSchema);
      this.#storedHelpBox = readStored(HELP_BOX_STORAGE_KEY, HomeHelpBoxSchema);
    }

    if (!this.#isBrowser) return;

    const unsubscribe = onSnapshot(
      this.#homeDocRef,
      (snapshot) => {
        const seed = snapshot.exists() ? toHomeSettingsSeed(snapshot.data()) : null;
        persistStoredSettings(seed);
        this.#homeDoc.set(seed);
        this.#markFirstAnswer();
      },
      () => {
        this.#homeDoc.set(null);
        this.#markFirstAnswer();
      },
    );
    this.#destroyRef.onDestroy(unsubscribe);
  }

  /**
   * Resolves once the home page has something real to show: the server seed,
   * a saved copy from an earlier visit, or the first live answer. Gives up
   * after a few seconds, so a slow connection still opens the page (with the
   * built-in sections) instead of hanging on the old one.
   */
  whenReady(): Promise<void> {
    if (this.#homeDoc() !== undefined || this.#storedHero) return Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, FIRST_SNAPSHOT_WAIT_MS)));
    return Promise.race([this.#firstAnswer, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * Indicates whether the live home settings document is loading.
   */
  readonly isLoading = computed<boolean>(() => this.#homeDoc() === undefined);

  /**
   * Live hero from Firestore; falls back to the saved copy, then DEFAULT_HOME_HERO.
   */
  readonly hero = computed<HomeHero>(
    () =>
      this.#homeDoc()?.hero ??
      this.#storedHero ??
      heroWithoutDeleted(DEFAULT_HOME_HERO, this.#catalog.deletedBuiltInIds()),
  );

  /**
   * Live Section 2 (Shop Categories) from Firestore; falls back to the saved
   * copy, then DEFAULT_HOME_SHOP_CATEGORIES.
   */
  readonly shopCategories = computed<HomeShopCategories>(
    () =>
      this.#homeDoc()?.shopCategories ??
      this.#storedShopCategories ??
      shopCardsWithoutDeleted(DEFAULT_HOME_SHOP_CATEGORIES, this.#catalog.deletedBuiltInIds()),
  );

  /**
   * Live Section 3 (category list) from Firestore. A settings/home document
   * without navList falls through to the saved list, then DEFAULT_HOME_NAV_LIST.
   */
  readonly navList = computed<HomeNavList>(
    () =>
      this.#homeDoc()?.navList ??
      this.#storedNavList ??
      navListWithoutDeleted(DEFAULT_HOME_NAV_LIST, this.#catalog.deletedBuiltInIds()),
  );

  /** Live Section 4 (Offer Banner, ATS-347); off until an admin sets it up. */
  readonly offerBanner = computed<HomeOfferBanner>(
    () => this.#homeDoc()?.offerBanner ?? this.#storedOfferBanner ?? DEFAULT_HOME_OFFER_BANNER,
  );

  /** Live Section 5 (WhatsApp Help, ATS-348); shows the built-in text until an admin edits it. */
  readonly helpBox = computed<HomeHelpBox>(
    () => this.#homeDoc()?.helpBox ?? this.#storedHelpBox ?? DEFAULT_HOME_HELP_BOX,
  );

  /**
   * Ids of the offers a banner may open (running, public, for everyone), null until the offers
   * load (and on the server), when the banner trusts what was published.
   */
  readonly #bannerOfferIds = computed<readonly string[] | null>(() =>
    this.#offers.ready()
      ? this.#offers
          .live()
          .filter(canShopOffer)
          .map((offer) => offer.id)
      : null,
  );

  /** The banner as shoppers see it, or null when it is off or its offer, category or brand can't be shown. */
  readonly storefrontOfferBanner = computed<HomeOfferBanner | null>(() =>
    offerBannerForStore(this.offerBanner(), this.#nav.targetCatalog(), this.#bannerOfferIds()),
  );

  /** The help box as shoppers see it, or null when it is off, empty or the store has no WhatsApp number. */
  readonly storefrontHelpBox = computed<HomeHelpBox | null>(() => {
    const box = this.helpBox();
    if (!box.enabled || !box.headline || !whatsappChatUrl(STORE_INFO.contact.whatsapp)) return null;
    return box;
  });

  /**
   * The three sections as shoppers see them (ATS-267): each button and link built from what it
   * points at, like the menus, so a renamed category's button follows it and a hidden or deleted
   * one is left out (a shop card opens Shop All instead). The admin edits the saved `hero`,
   * `shopCategories` and `navList` above.
   */
  readonly storefrontHero = computed<HomeHero>(() => heroWithTargets(this.hero(), this.#nav.targetCatalog()));
  readonly storefrontShopCategories = computed<HomeShopCategories>(() =>
    shopCardsWithTargets(this.shopCategories(), this.#nav.targetCatalog()),
  );
  readonly storefrontNavList = computed<HomeNavList>(() =>
    navListWithTargets(this.navList(), this.#nav.targetCatalog()),
  );

  /**
   * Publishes the homepage hero, shop cards, and category list together. `updatedBy` (the saver's
   * uid) goes on the doc so Previous Versions can say who saved each version (ATS-251).
   */
  async updateHomeSettings(settings: HomeSettingsUpdate, updatedBy: string): Promise<void> {
    const payload: HomeSettings = {
      id: 'home',
      hero: settings.hero,
      shopCategories: settings.shopCategories,
      navList: settings.navList,
      offerBanner: settings.offerBanner,
      helpBox: settings.helpBox,
      updatedAt: serverTimestamp(),
      updatedBy,
    };
    // Overwrite the whole doc (it carries every field): a merge would keep old keys inside nested
    // objects, e.g. a banner's earlier `target.filters` or a `target` the banner no longer has.
    await setDoc(this.#homeDocRef, payload);
  }

  /**
   * Resets all home page sections to factory defaults.
   */
  async resetDefaultHomeSettings(updatedBy: string): Promise<void> {
    await this.updateHomeSettings(
      {
        hero: DEFAULT_HOME_HERO,
        shopCategories: DEFAULT_HOME_SHOP_CATEGORIES,
        navList: DEFAULT_HOME_NAV_LIST,
        offerBanner: DEFAULT_HOME_OFFER_BANNER,
        helpBox: DEFAULT_HOME_HELP_BOX,
      },
      updatedBy,
    );
  }
}
