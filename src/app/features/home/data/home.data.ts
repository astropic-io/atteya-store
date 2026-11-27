import {
  HeroSlide,
  HomeHelpBox,
  HomeHero,
  HomeNavList,
  HomeNavListItem,
  HomeOfferBanner,
  HomeShopCategories,
  ShopCategoryCard,
} from '../models/home.model';

export const DEFAULT_HERO_SLIDES: readonly HeroSlide[] = [
  {
    headline: 'Performance-grade gear.',
    subtitle: 'Apparel built for however you train.',
    imageUrl: '',
    imageAlt: 'Athlete training in performance sportswear',
    actions: [
      { label: "Shop men's", link: '/category/apparel?gender=men' },
      { label: "Shop women's", link: '/category/apparel?gender=women' },
    ],
  },
  {
    headline: 'Dominate the court.',
    subtitle: 'Precision-engineered padel rackets and pro accessories.',
    imageUrl: '',
    imageAlt: 'Padel player preparing to serve on court',
    actions: [{ label: 'Shop rackets', link: '/category/rackets' }],
  },
  {
    headline: 'Carry the kit.',
    subtitle: 'Court bags and gear that keep everything ready to play.',
    imageUrl: '',
    imageAlt: 'Padel bag packed with rackets and court gear',
    actions: [{ label: 'Shop bags', link: '/category/bags' }],
  },
];

export const DEFAULT_HOME_HERO: HomeHero = {
  layoutCount: 3,
  slides: [
    { ...DEFAULT_HERO_SLIDES[0], actions: [...DEFAULT_HERO_SLIDES[0].actions] },
    { ...DEFAULT_HERO_SLIDES[1], actions: [...DEFAULT_HERO_SLIDES[1].actions] },
    { ...DEFAULT_HERO_SLIDES[2], actions: [...DEFAULT_HERO_SLIDES[2].actions] },
  ],
};

export const SHOP_CATEGORIES_CARD_COUNT = 3;

export const DEFAULT_SHOP_CATEGORY_CARDS: readonly ShopCategoryCard[] = [
  {
    imageUrl: '',
    imageAlt: 'Professional padel rackets ready for court play',
    buttonLabel: 'Rackets',
    buttonLink: '/category/rackets',
  },
  {
    imageUrl: '',
    imageAlt: 'Lightweight breathable training apparel',
    buttonLabel: 'Apparel',
    buttonLink: '/category/apparel',
  },
  {
    imageUrl: '',
    imageAlt: 'Pro padel bags, caps, and athletic accessories',
    buttonLabel: 'Accessories',
    buttonLink: '/category/accessories',
  },
];

export const DEFAULT_HOME_SHOP_CATEGORIES: HomeShopCategories = {
  title: 'Shop',
  cards: DEFAULT_SHOP_CATEGORY_CARDS.map((card) => ({ ...card })),
};

export const NAV_LIST_MAX_ITEMS = 10;

const DEFAULT_NAV_LIST_ITEMS: readonly HomeNavListItem[] = [
  { label: 'Rackets', link: '/category/rackets', imageUrl: '', imageAlt: '' },
  { label: 'Bags', link: '/category/accessories/bags', imageUrl: '', imageAlt: '' },
  { label: 'Accessories', link: '/category/accessories', imageUrl: '', imageAlt: '' },
  { label: 'Socks', link: '/category/socks', imageUrl: '', imageAlt: '' },
  { label: 'Shorts', link: '/category/shorts', imageUrl: '', imageAlt: '' },
  { label: 'Shop all', link: '/shop', imageUrl: '', imageAlt: '' },
];

export const DEFAULT_HOME_NAV_LIST: HomeNavList = {
  title: 'Shop by category',
  items: DEFAULT_NAV_LIST_ITEMS.map((item) => ({ ...item })),
};

/** Section 4 starts off: it needs a photo and a link before it can show (ATS-347). */
export const DEFAULT_HOME_OFFER_BANNER: HomeOfferBanner = {
  enabled: false,
  label: '',
  headline: '',
  link: '',
  linkText: '',
  imageUrl: '',
  imageAlt: '',
  phoneImageUrl: '',
};

/** Section 5 shows by default with this text (ATS-348). */
export const DEFAULT_HOME_HELP_BOX: HomeHelpBox = {
  enabled: true,
  headline: 'Not sure which racket fits you?',
  text: "Tell us how you play and we'll help you choose.",
  message: '',
};

/** A text limit for the admin: at most `chars` characters and (when set) `words` words. */
export interface HomeTextLimit {
  readonly chars: number;
  readonly words?: number;
}

/**
 * Text limits that keep the home sections' layout from breaking (ATS-346, ATS-347, ATS-348).
 * Admin → Home Page shows a counter for each and Publish to Store refuses text over them.
 */
export const HOME_TEXT_LIMITS = {
  navListName: { chars: 14 },
  navListCaption: { chars: 36, words: 6 },
  bannerLabel: { chars: 20, words: 3 },
  bannerHeadline: { chars: 40, words: 7 },
  helpHeadline: { chars: 40, words: 7 },
  helpText: { chars: 70, words: 12 },
  helpMessage: { chars: 120 },
} as const satisfies Record<string, HomeTextLimit>;

/** Words in a piece of text, as the limits count them. */
export function homeWordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Whether `text` fits `limit`. */
export function fitsHomeTextLimit(text: string, limit: HomeTextLimit): boolean {
  const trimmed = text.trim();
  if (trimmed.length > limit.chars) return false;
  return limit.words === undefined || homeWordCount(trimmed) <= limit.words;
}
