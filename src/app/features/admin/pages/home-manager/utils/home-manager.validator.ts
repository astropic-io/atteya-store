import { diffOrphanedPaths } from '@shared/utils/image';
import type { NavTarget } from '@core/services/navigation/nav-target';
import {
  fitsHomeTextLimit,
  HOME_TEXT_LIMITS,
  NAV_LIST_MAX_ITEMS,
  SHOP_CATEGORIES_CARD_COUNT,
} from '@features/home/data/home.data';
import type { HomeHelpBox, HomeOfferBanner } from '@features/home/models/home.model';
import { textLimitRule } from './home-text-limits';
import {
  HeroAction,
  HeroSlide,
  HomeHero,
  HomeNavList,
  HomeNavListItem,
  HomeShopCategories,
  ShopCategoryCard,
} from '../models/home-manager.model';

/**
 * Why a link can't be published ("pick where it goes"), or null (ATS-267; `homeLinkProblem` with
 * the catalogue). `allowOutside`: whether an Outside Link may be used there.
 */
export type HomeLinkCheck = (
  target: NavTarget | undefined,
  link: string,
  allowOutside: boolean,
) => string | null;

const NO_LINK_CHECK: HomeLinkCheck = (target, link) => (target || link.trim() ? null : 'pick where it goes');

/**
 * Validates a single hero action button.
 */
export function validateHeroAction(
  action: HeroAction,
  actionIndex: number,
  prefix: string,
  checkLink: HomeLinkCheck = NO_LINK_CHECK,
): string | null {
  if (!action.label || action.label.trim().length === 0) {
    return `${prefix}Action #${actionIndex + 1} requires a button label.`;
  }
  const problem = checkLink(action.target, action.link, true);
  if (problem) return `${prefix}Button "${action.label}": ${problem}.`;
  return null;
}

/**
 * Validates a single hero card/slide.
 */
export function validateHeroSlide(
  slide: HeroSlide,
  slideIndex: number,
  totalSlides: number,
  checkLink: HomeLinkCheck = NO_LINK_CHECK,
): string | null {
  const prefix = totalSlides > 1 ? `Banner #${slideIndex + 1}: ` : '';

  if (!slide.headline || slide.headline.trim().length < 3) {
    return `${prefix}Headline must be at least 3 characters long.`;
  }
  if (!slide.subtitle || slide.subtitle.trim().length === 0) {
    return `${prefix}Subtitle cannot be empty.`;
  }
  if (!slide.imageUrl || slide.imageUrl.trim().length === 0) {
    return `${prefix}Background image cannot be empty.`;
  }
  if (!slide.imageAlt || slide.imageAlt.trim().length === 0) {
    return `${prefix}Please provide an image description (alt text) for accessibility and SEO.`;
  }
  if (!slide.actions || slide.actions.length === 0) {
    return `${prefix}Please add at least one action button.`;
  }

  for (let i = 0; i < slide.actions.length; i++) {
    const err = validateHeroAction(slide.actions[i], i, prefix, checkLink);
    if (err) return err;
  }

  return null;
}

/**
 * Validates all active hero slides before publishing.
 */
export function validateHomeHeroDraft(
  hero: HomeHero,
  checkLink: HomeLinkCheck = NO_LINK_CHECK,
): string | null {
  const activeSlides = hero.slides.slice(0, hero.layoutCount);
  if (activeSlides.length < hero.layoutCount) {
    return 'Please complete all active banner cards before publishing.';
  }

  for (let i = 0; i < activeSlides.length; i++) {
    const err = validateHeroSlide(activeSlides[i], i, hero.layoutCount, checkLink);
    if (err) return err;
  }

  return null;
}

/**
 * Validates a single Shop Category card in Section 2.
 */
export function validateShopCategoryCard(
  card: ShopCategoryCard,
  cardIndex: number,
  checkLink: HomeLinkCheck = NO_LINK_CHECK,
): string | null {
  const prefix = `Section 2 • Card #${cardIndex + 1}: `;

  if (!card.buttonLabel || card.buttonLabel.trim().length === 0) {
    return `${prefix}Button label cannot be empty.`;
  }
  const linkProblem = checkLink(card.target, card.buttonLink, true);
  if (linkProblem) return `${prefix}Button "${card.buttonLabel}": ${linkProblem}.`;
  if (!card.imageUrl || card.imageUrl.trim().length === 0) {
    return `${prefix}Please upload an image for "${card.buttonLabel}".`;
  }
  if (!card.imageAlt || card.imageAlt.trim().length === 0) {
    return `${prefix}Please provide an image description (alt text) for "${card.buttonLabel}".`;
  }

  return null;
}

/**
 * Validates Section 2 (Shop Categories) before publishing.
 */
export function validateHomeShopCategoriesDraft(
  shopCategories: HomeShopCategories,
  checkLink: HomeLinkCheck = NO_LINK_CHECK,
): string | null {
  if (!shopCategories.title || shopCategories.title.trim().length === 0) {
    return 'Section 2: Section title cannot be empty (e.g. "Shop").';
  }

  const cards = shopCategories.cards.slice(0, SHOP_CATEGORIES_CARD_COUNT);
  if (cards.length < SHOP_CATEGORIES_CARD_COUNT) {
    return 'Section 2: Please configure all 3 category cards before publishing.';
  }

  for (let i = 0; i < cards.length; i++) {
    const err = validateShopCategoryCard(cards[i], i, checkLink);
    if (err) return err;
  }

  return null;
}

function isInternalLink(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//');
}

/**
 * Validates one category-list link. The photo is decorative, so a description is optional.
 */
export function validateNavListItem(
  item: HomeNavListItem,
  itemIndex: number,
  checkLink: HomeLinkCheck = NO_LINK_CHECK,
): string | null {
  const name = item.label.trim();
  const prefix = `Section 3, link ${itemIndex + 1}: `;

  if (!name) {
    return `${prefix}Add a name.`;
  }
  if (!fitsHomeTextLimit(name, HOME_TEXT_LIMITS.navListName)) {
    return `${prefix}The name is too long for the list. ${textLimitRule(HOME_TEXT_LIMITS.navListName)}`;
  }
  if (!fitsHomeTextLimit(item.caption ?? '', HOME_TEXT_LIMITS.navListCaption)) {
    return `${prefix}Short line: ${textLimitRule(HOME_TEXT_LIMITS.navListCaption)}`;
  }
  const linkProblem = checkLink(item.target, item.link, false);
  if (linkProblem) return `${name}: ${linkProblem}.`;
  if (!isInternalLink(item.link.trim())) return `${name}: pick where it goes.`;
  if (!item.imageUrl.trim()) {
    return `${name} needs a photo.`;
  }
  return null;
}

/**
 * Validates Section 3 before publishing.
 */
export function validateHomeNavListDraft(
  navList: HomeNavList,
  checkLink: HomeLinkCheck = NO_LINK_CHECK,
): string | null {
  const title = navList.title.trim();
  if (!title) {
    return 'Add a heading for the category list.';
  }

  const items = navList.items.slice(0, NAV_LIST_MAX_ITEMS);
  if (items.length < 2) {
    return 'Add at least two categories before publishing this list.';
  }
  if (navList.items.length > NAV_LIST_MAX_ITEMS) {
    return 'You can show up to 10 categories in this list.';
  }

  for (let i = 0; i < items.length; i++) {
    const err = validateNavListItem(items[i], i, checkLink);
    if (err) return err;
  }
  return null;
}

/**
 * Validates Section 4 (Offer Banner, ATS-347) before publishing. A banner that is turned off
 * publishes as it is, so a half-made one can wait for its photo.
 */
export function validateHomeOfferBanner(
  banner: HomeOfferBanner,
  checkLink: HomeLinkCheck = NO_LINK_CHECK,
): string | null {
  if (!banner.enabled) return null;
  const prefix = 'Section 4: ';
  if (!banner.target && !banner.link.trim()) return `${prefix}Pick where the banner goes.`;
  const linkProblem = checkLink(banner.target, banner.link, false);
  if (linkProblem) return `${prefix}The banner link: ${linkProblem}.`;
  if (!isInternalLink(banner.link.trim())) return `${prefix}Pick where the banner goes.`;
  if (!banner.headline.trim()) return `${prefix}Add a headline.`;
  if (!fitsHomeTextLimit(banner.headline, HOME_TEXT_LIMITS.bannerHeadline)) {
    return `${prefix}Headline: ${textLimitRule(HOME_TEXT_LIMITS.bannerHeadline)}`;
  }
  if (!fitsHomeTextLimit(banner.label, HOME_TEXT_LIMITS.bannerLabel)) {
    return `${prefix}Small label: ${textLimitRule(HOME_TEXT_LIMITS.bannerLabel)}`;
  }
  if (!banner.imageUrl.trim()) return `${prefix}Add the wide photo.`;
  return null;
}

/** Validates Section 5 (WhatsApp Help, ATS-348) before publishing. */
export function validateHomeHelpBox(box: HomeHelpBox): string | null {
  if (!box.enabled) return null;
  const prefix = 'Section 5: ';
  if (!box.headline.trim()) return `${prefix}Add a headline.`;
  if (!fitsHomeTextLimit(box.headline, HOME_TEXT_LIMITS.helpHeadline)) {
    return `${prefix}Headline: ${textLimitRule(HOME_TEXT_LIMITS.helpHeadline)}`;
  }
  if (!fitsHomeTextLimit(box.text, HOME_TEXT_LIMITS.helpText)) {
    return `${prefix}Line under the headline: ${textLimitRule(HOME_TEXT_LIMITS.helpText)}`;
  }
  if (!fitsHomeTextLimit(box.message, HOME_TEXT_LIMITS.helpMessage)) {
    return `${prefix}First message: ${textLimitRule(HOME_TEXT_LIMITS.helpMessage)}`;
  }
  return null;
}

/**
 * Computes Firebase Storage paths that are no longer referenced by the kept slides.
 */
export function collectOrphanedStoragePaths(
  candidatePaths: readonly string[],
  keptSlides: readonly HeroSlide[],
): string[] {
  return diffOrphanedPaths(
    candidatePaths,
    keptSlides.map((s) => s.imageUrl),
  );
}
