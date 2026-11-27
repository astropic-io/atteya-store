import { makeStateKey } from '@angular/core';
import type {
  HomeHelpBox,
  HomeHero,
  HomeNavList,
  HomeOfferBanner,
  HomeSettings,
  HomeShopCategories,
} from '../models/home.model';

/** Plain settings carried from the server render into the browser. No timestamps. */
export interface HomeSettingsSeed {
  readonly hero: HomeHero;
  readonly shopCategories?: HomeShopCategories;
  readonly navList?: HomeNavList;
  readonly offerBanner?: HomeOfferBanner;
  readonly helpBox?: HomeHelpBox;
}

export const HOME_SETTINGS_KEY = makeStateKey<HomeSettingsSeed | null>('home-settings');

export function toHomeSettingsSeed(settings: HomeSettings): HomeSettingsSeed {
  return {
    hero: settings.hero,
    ...(settings.shopCategories ? { shopCategories: settings.shopCategories } : {}),
    ...(settings.navList ? { navList: settings.navList } : {}),
    ...(settings.offerBanner ? { offerBanner: settings.offerBanner } : {}),
    ...(settings.helpBox ? { helpBox: settings.helpBox } : {}),
  };
}
