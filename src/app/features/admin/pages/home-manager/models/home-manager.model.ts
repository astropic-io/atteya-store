import {
  HeroAction,
  HeroLayoutCount,
  HeroSlide,
  HomeHero,
  HomeNavList,
  HomeNavListItem,
  HomeHelpBox,
  HomeOfferBanner,
  HomeShopCategories,
  ShopCategoryCard,
} from '@features/home/models/home.model';

export type HomeSectionTab = 'hero' | 'categories' | 'navList' | 'offerBanner' | 'helpBox';

export interface ActionMoveEvent {
  readonly index: number;
  readonly direction: 'up' | 'down';
}

export type {
  HomeHero,
  HeroAction,
  HeroSlide,
  HeroLayoutCount,
  HomeShopCategories,
  ShopCategoryCard,
  HomeNavList,
  HomeNavListItem,
  HomeOfferBanner,
  HomeHelpBox,
};
