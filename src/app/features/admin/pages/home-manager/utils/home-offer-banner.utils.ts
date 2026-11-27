import type { Offer } from '@core/services/offers/engine';
import {
  navTargetName,
  resolveNavTarget,
  type NavTarget,
  type NavTargetCatalog,
} from '@core/services/navigation/nav-target';
import { fitsHomeTextLimit, HOME_TEXT_LIMITS } from '@features/home/data/home.data';
import type { HomeOfferBanner } from '@features/home/models/home.model';
import { targetAndPath } from '../../navigation-manager/utils/navigation-targets.utils';

/** What kind of offer a banner opens (Admin → Offers type), null for anything else. */
export type BannerOfferKind = Offer['reward']['kind'] | null;

/** The small label above the headline, filled in from what the banner opens (ATS-347). */
const OFFER_LABELS: Record<Offer['reward']['kind'], string> = {
  percentOff: 'Limited Offer',
  amountOff: 'Limited Offer',
  fixedPrice: 'Limited Offer',
  tiered: 'More for Less',
  bundlePrice: 'More for Less',
  bundleSet: 'Bundle & Save',
  buyXGetY: 'Special Offer',
  freeGift: 'Free Gift',
  freeShipping: 'Free Shipping',
};

export interface BannerAutoText {
  /** Suggested small label; the admin can change it. */
  readonly label: string;
  /** The link's words under the headline; always written for the admin. */
  readonly linkText: string;
}

/**
 * The label and link text for a banner that opens `target`: "Shop the Set" for a Bundle & Save
 * offer, "Shop the Offer" for any other offer, "Shop <name>" for a category, brand or page.
 */
export function bannerAutoText(
  target: NavTarget | undefined,
  catalog: NavTargetCatalog,
  offerKind: BannerOfferKind,
): BannerAutoText {
  if (!target) return { label: '', linkText: 'Shop Now' };
  if (target.kind === 'offer') {
    return {
      label: offerKind ? OFFER_LABELS[offerKind] : 'Limited Offer',
      linkText: offerKind === 'bundleSet' ? 'Shop the Set' : 'Shop the Offer',
    };
  }
  const name = target.kind === 'url' ? null : navTargetName(target, catalog);
  if (!name) return { label: '', linkText: 'Shop Now' };
  return {
    label: fitsHomeTextLimit(name, HOME_TEXT_LIMITS.bannerLabel) ? name : '',
    linkText: `Shop ${name}`,
  };
}

/**
 * Where an offer banner goes: a Bundle & Save offer (`bundleSet`) has its own page, where the
 * shopper picks each item; every other offer opens Shop filtered to it.
 */
export function bannerOfferPath(offerId: string, offerKind: BannerOfferKind): string | null {
  return offerKind === 'bundleSet' ? `/bundle/${encodeURIComponent(offerId)}` : null;
}

/**
 * The banner as it is saved: its target, the address built from it (a Bundle & Save offer's own
 * page) and the link text. No `target` key when there is none (Firestore refuses undefined).
 */
export function bannerToSave(
  banner: HomeOfferBanner,
  catalog: NavTargetCatalog,
  offerKind: (offerId: string) => BannerOfferKind,
): HomeOfferBanner {
  const { target, path } = targetAndPath(banner.target, banner.link, catalog);
  const kind = target?.kind === 'offer' ? offerKind(target.id) : null;
  const link = target?.kind === 'offer' ? (bannerOfferPath(target.id, kind) ?? path) : path;
  const next: HomeOfferBanner = {
    ...banner,
    link,
    linkText: target ? bannerAutoText(target, catalog, kind).linkText : banner.linkText,
  };
  if (target) next.target = target;
  else delete next.target;
  return next;
}

/**
 * Why shoppers don't see the published banner right now, or null when they do (shown on the
 * admin tab). `catalog` with running offers (`NavigationCatalogService.targetCatalog`).
 */
export function bannerHiddenReason(banner: HomeOfferBanner, catalog: NavTargetCatalog | null): string | null {
  if (!banner.enabled) return 'The banner is turned off, so shoppers don’t see it.';
  if (!banner.headline.trim() || !banner.imageUrl.trim()) {
    return 'Shoppers don’t see the banner until it has a headline and a wide photo.';
  }
  const target = banner.target;
  if (!catalog || !target || target.kind === 'url') return null;
  const { problem } = resolveNavTarget(target, catalog);
  if (problem === 'ended') {
    return 'Hidden on the store: its offer isn’t running now (it ended, is paused or needs a code).';
  }
  if (problem === 'hidden' || problem === 'missing') {
    const what = target.kind === 'brand' ? 'brand' : 'category';
    return `Hidden on the store: its ${what} is hidden or has been removed.`;
  }
  return null;
}
