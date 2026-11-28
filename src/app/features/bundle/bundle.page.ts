import { isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  PLATFORM_ID,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { STORE_INFO, whatsappChatUrl } from '@core/config/store-info';
import { AuthService } from '@core/services/auth/auth.service';
import { type BagPricingProduct, priceBag } from '@core/services/cart/cart-deals';
import type { CartLineDraft } from '@core/services/cart/cart.model';
import { CartService } from '@core/services/cart/cart.service';
import { CurrencyService } from '@core/services/currency/currency.service';
import { DrawerService } from '@core/services/drawer/drawer.service';
import {
  displayDecimals,
  type Offer,
  type OfferBundleSlot,
  bundleSetSlots,
  toDisplayAmount,
} from '@core/services/offers/engine';
import { toPricedProduct } from '@core/services/offers/offer.model';
import { bundleSetSavingLabel, canShopOffer, offerTextFor } from '@core/services/offers/offer-shop';
import { fromTransferOffer } from '@core/services/offers/offer-transfer';
import { OffersService } from '@core/services/offers/offers.service';
import { SeoService } from '@core/services/seo';
import { SnackbarService } from '@core/services/snack-bar/snack-bar.service';
import { MetaPixelService } from '@core/services/analytics/meta-pixel.service';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { ErrorPageComponent } from '@shared/ui/error-page';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { SkeletonComponent } from '@shared/ui/skeleton';
import { normalizeImageKitPath } from '@shared/utils/image';
import { formatMoney } from '@shared/utils/money';
import { ChoiceRowComponent } from '../product/components/choice-row/choice-row.component';
import { ChoicePickerService } from '../product/dialogs/choice-picker/choice-picker.service';
import { type ChoiceRowView, choiceRowView } from '../product/utils/choice-rows';
import { type BundleChoice, bundlePieceLine } from '../product/utils/product-bundle';
import type { BundlePageResult } from './models/bundle-page.model';
import { BundleProductsService } from './services/bundle-products.service';
import {
  type BundleGroupFacts,
  type BundleGroupPicks,
  type BundlePiecePick,
  bundleEndsIn,
  bundleGroupFacts,
  bundlePageState,
  bundleStartsOn,
  firstOpenGroup,
  groupComplete,
  groupFixed,
  nextBundleAction,
  setPiecePick,
  soldOutText,
  startingPicks,
} from './utils/bundle-page';

/** One piece of the bundle as a row: a row that opens the choice panel, an included product, or sold out. */
interface PieceRow {
  readonly group: number;
  readonly piece: number;
  /** "Racket", "Balls 2". */
  readonly title: string;
  readonly mode: 'choose' | 'included' | 'soldOut';
  readonly view: ChoiceRowView | null;
  /** The included product (its group has only this one, with no size to pick). */
  readonly included: { readonly label: string; readonly imagePath: string } | null;
  readonly soldOutText: string;
}

/** One photo of the set: the picked product, or the group's first product greyed until one is picked. */
interface SetPhoto {
  readonly group: number;
  readonly name: string;
  readonly imagePath: string;
  readonly picked: boolean;
}

/** Picks and the products they name, priced the way the bag prices them. */
interface BundleTotals {
  readonly normal: number;
  readonly total: number;
}

/**
 * The Bundle & Save page, `/bundle/<offer id>` (ATS-279): the shopper picks a product (and size)
 * from each group of the offer and adds the whole bundle to the bag in one tap. Server-rendered
 * header (kicker, title, saving); the groups' products are read in the browser.
 */
@Component({
  selector: 'app-bundle-page',
  imports: [
    NgOptimizedImage,
    RouterLink,
    MatButtonModule,
    AppImageFallbackDirective,
    ChoiceRowComponent,
    ErrorPageComponent,
    SharedIconModule,
    SkeletonComponent,
  ],
  templateUrl: './bundle.page.html',
  host: { class: 'block w-full' },
})
export class BundlePage {
  readonly page = input.required<BundlePageResult>();
  /** `?product=<id>`: the product page the shopper came from; it starts picked in its group. */
  readonly product = input<string | undefined>(undefined);
  /** `?from=bag`: the bag's pieces for this offer start picked, and the page scrolls to the first missing group. */
  readonly from = input<string | undefined>(undefined);

  readonly #auth = inject(AuthService);
  readonly #cart = inject(CartService);
  readonly #currency = inject(CurrencyService);

  /** The offer's title, left out when it names pounds and the visitor pays in another currency (<KEY>-309). */
  readonly pageTitle = computed(() => {
    const title = this.offer()?.title.trim() ?? '';
    return offerTextFor(title, this.#currency.selected()) || 'Bundle & Save';
  });
  readonly #drawer = inject(DrawerService);
  readonly #liveOffers = inject(OffersService);
  readonly #reader = inject(BundleProductsService);
  readonly #seo = inject(SeoService);
  readonly #snackbar = inject(SnackbarService);
  readonly #pixel = inject(MetaPixelService);
  readonly #picker = inject(ChoicePickerService);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #injector = inject(Injector);
  readonly #platformId = inject(PLATFORM_ID);

  readonly path = normalizeImageKitPath;
  readonly whatsappUrl = whatsappChatUrl(STORE_INFO.contact.whatsapp);

  /** False until the first browser render, so hydration matches the server HTML. */
  readonly #hydrated = signal(false);
  /** Pricing clock: the render time first, then the browser's clock every minute. */
  readonly #nowMs = linkedSignal(() => {
    const p = this.page();
    return p.status === 'found' ? p.renderedAtMs : Date.now();
  });
  /** The offer whose page already scrolled to its first missing group (`?from=bag`). */
  #scrolledFor: string | null = null;

  readonly #offerId = computed(() => {
    const p = this.page();
    return p.status === 'found' ? p.offer.id : '';
  });

  readonly offer = computed<Offer | null>(() => {
    const p = this.page();
    return p.status === 'found' ? fromTransferOffer(p.offer) : null;
  });

  readonly slots = computed<readonly OfferBundleSlot[]>(() => {
    // The engine's reader: a malformed reward has no groups, exactly as the bag prices it.
    const reward = this.offer()?.reward;
    return reward ? bundleSetSlots(reward) : [];
  });

  /** The live offers no longer have it (paused, archived or deleted since the page opened). */
  readonly #goneLive = computed(() => {
    const offer = this.offer();
    if (!offer || !this.#hydrated() || !this.#liveOffers.ready() || this.#liveOffers.failed()) return false;
    return !this.#liveOffers.all().some((entry) => entry.id === offer.id);
  });

  /** Live offers after hydration (other offers change the pieces' own prices), always with this one. */
  readonly #offers = computed<readonly Offer[]>(() => {
    const offer = this.offer();
    if (!offer) return [];
    if (!this.#hydrated() || !this.#liveOffers.ready() || this.#liveOffers.failed()) return [offer];
    const all = this.#liveOffers.all();
    return all.some((entry) => entry.id === offer.id) ? all : [...all, offer];
  });

  readonly #pricingCtx = computed(() => ({
    now: new Date(this.#nowMs()),
    signedIn: this.#hydrated() && this.#auth.offerSignedIn(),
  }));

  /** Can the bundle be bought now? Signed-in-only offers wait for the browser to know who is here. */
  readonly state = computed(() => {
    const offer = this.offer();
    if (!offer) return 'unavailable' as const;
    if (this.#goneLive()) return 'ended' as const;
    const state = bundlePageState(offer, this.#nowMs(), this.#pricingCtx().signedIn, this.slots().length);
    if (state === 'members' && !(this.#hydrated() && this.#auth.isAuthReady())) return 'checking' as const;
    return state;
  });

  /** Signed in, but the email isn't confirmed yet (member prices need a confirmed email). */
  readonly needsConfirmedEmail = computed(() => this.#hydrated() && this.#auth.isAuthenticated());

  /** "Bundle & Save · Ends in 2d 14h", "Bundle & Save · Members". */
  readonly kicker = computed(() => {
    const offer = this.offer();
    if (!offer) return 'Bundle & Save';
    if (this.state() === 'open') {
      const ends = bundleEndsIn(offer.schedule.endsAt?.getTime() ?? null, this.#nowMs());
      if (ends) return `Bundle & Save · ${ends}`;
    }
    return offer.audience === 'signedIn' ? 'Bundle & Save · Members' : 'Bundle & Save';
  });

  /** "Save 60%", "Save EGP 500", "All for EGP 4,500", "Cheapest one free"; none once it can't be bought. */
  readonly saving = computed(() => {
    const reward = this.offer()?.reward;
    const state = this.state();
    if (reward?.kind !== 'bundleSet' || state === 'ended' || state === 'unavailable') return '';
    return bundleSetSavingLabel(reward.setReward, (egp) => this.#money(egp));
  });

  /** The grey note when the bundle can't be bought. */
  readonly note = computed(() => {
    const offer = this.offer();
    switch (this.state()) {
      case 'ended':
        return {
          title: 'This bundle has ended.',
          text: 'Its products are still in the shop at their normal price.',
        };
      case 'upcoming':
        return offer?.schedule.startsAt
          ? {
              title: bundleStartsOn(offer.schedule.startsAt),
              text: 'Its products are in the shop now at their normal price.',
            }
          : null;
      case 'unavailable':
        return {
          title: "This bundle isn't available right now.",
          text: 'Its products are still in the shop at their normal price.',
        };
      default:
        return null;
    }
  });

  /** Shop These Products: the offer's Shop page when Shop can list it, else Shop. */
  readonly shopQuery = computed(() => {
    const offer = this.offer();
    return offer && canShopOffer(offer) ? { offer: offer.id } : null;
  });

  readonly signInQuery = computed(() => ({ returnUrl: `/bundle/${this.offer()?.id ?? ''}` }));

  /** What the products read depends on: plain values, so a price change reads nothing again. */
  readonly #readKey = computed(() => {
    const offer = this.offer();
    if (!this.#hydrated() || !offer || this.state() !== 'open') return undefined;
    return offer.id;
  });

  /** The products of each group, read in the browser. */
  readonly #choices = resource({
    params: () => this.#readKey(),
    loader: () => {
      const offer = untracked(this.offer);
      return offer ? this.#reader.choicesByGroup(offer, untracked(this.slots)) : Promise.resolve([]);
    },
  });

  readonly loading = computed(
    () =>
      this.state() === 'checking' ||
      (this.state() === 'open' && !this.#choices.hasValue() && !this.#choices.error()),
  );
  readonly failed = computed(() => this.state() === 'open' && !!this.#choices.error());

  readonly #choiceLists = computed<readonly (readonly BundleChoice[])[] | null>(() =>
    this.#choices.hasValue() ? this.#choices.value() : null,
  );

  readonly #groups = computed<readonly BundleGroupFacts[]>(() => {
    const lists = this.#choiceLists();
    if (!lists) return [];
    return bundleGroupFacts(
      this.slots(),
      lists.map((list) => list.map((choice) => choice.view)),
    );
  });

  /** Picks start once the products are read (and, from the bag, once the bag has loaded). */
  readonly #picksKey = computed(() => {
    const offer = this.offer();
    if (!offer || !this.#choiceLists()) return '';
    const fromBag = this.from() === 'bag';
    if (fromBag && !this.#cart.ready()) return '';
    return `${offer.id}|${this.product() ?? ''}|${fromBag}`;
  });

  readonly #picks = linkedSignal<string, BundleGroupPicks>({
    source: () => this.#picksKey(),
    // Untracked: a later bag change (another tab, Add Bundle to Bag itself) never resets the picks.
    computation: (key) =>
      key ? untracked(() => startingPicks(this.#groups(), this.product() ?? null, this.#bagPieces())) : [],
  });

  /**
   * The bag's pieces of this offer's products that are not in a finished set yet (`?from=bag`),
   * one entry per piece, priced by the bag's own `priceBag()` to know which pieces a set took.
   */
  #bagPieces(): BundlePiecePick[] {
    const offer = this.offer();
    if (this.from() !== 'bag' || !offer) return [];
    const lines = this.#cart.lines();
    const priced = priceBag(lines, this.#pricingProducts(), this.#offers(), this.#pricingCtx());
    return lines.flatMap((line, index) => {
      const inSets = (priced.lines[index]?.deals.deals ?? [])
        .filter((deal) => deal.set && deal.offerId === offer.id)
        .reduce((sum, deal) => sum + deal.units, 0);
      const left = Math.min(Math.max(0, line.quantity - inSets), 5);
      return Array.from({ length: left }, () => ({
        productId: line.productId,
        sizeId: line.selection['size'] ?? null,
      }));
    });
  }

  /** The products the page read, as the bag prices them. */
  #pricingProducts(): Map<string, BagPricingProduct> {
    const products = new Map<string, BagPricingProduct>();
    for (const choice of (this.#choiceLists() ?? []).flat()) {
      products.set(choice.product.id, {
        priced: toPricedProduct(choice.product),
        options: choice.product.options,
        variants: choice.product.variants,
      });
    }
    return products;
  }

  readonly soldOut = computed(() => this.#groups().some((group) => group.choices.length === 0));
  readonly soldOutNote = computed(() => {
    const group = this.#groups().find((entry) => entry.choices.length === 0);
    return group ? soldOutText(group.name) : '';
  });

  readonly action = computed(() => nextBundleAction(this.#groups(), this.#picks()));

  /** The product a choice names, for prices and bag lines. */
  #choice(group: number, productId: string): BundleChoice | undefined {
    return this.#choiceLists()?.[group]?.find((entry) => entry.view.productId === productId);
  }

  /** One row per piece: "Racket", or "Balls 1", "Balls 2" for a group of 2+. A sold-out group has one row. */
  readonly rows = computed<readonly PieceRow[]>(() => {
    const picks = this.#picks();
    return this.#groups().flatMap((group, index): PieceRow[] => {
      const base = { group: index, view: null, included: null, soldOutText: '' };
      if (group.choices.length === 0) {
        return [
          { ...base, piece: 0, title: group.name, mode: 'soldOut', soldOutText: soldOutText(group.name) },
        ];
      }
      const only = groupFixed(group) ? group.choices[0]! : null;
      return Array.from({ length: group.quantity }, (_, piece): PieceRow => {
        const title = group.quantity > 1 ? `${group.name} ${piece + 1}` : group.name;
        if (only && !only.sizes) {
          return {
            ...base,
            piece,
            title,
            mode: 'included',
            included: { label: only.label, imagePath: only.imagePath },
          };
        }
        const pick = picks[index]?.[piece] ?? null;
        const view = choiceRowView(group.choices, pick?.productId ?? null, pick?.sizeId ?? null);
        return { ...base, piece, title, mode: 'choose', view };
      });
    });
  });

  /** The set's photos, one per group (up to 4): what is picked, else the group's first product, greyed. */
  readonly photos = computed<readonly SetPhoto[]>(() => {
    const picks = this.#picks();
    return this.#groups()
      .slice(0, 4)
      .map((group, index) => {
        const pick = picks[index]?.[0];
        const choice =
          (pick && group.choices.find((entry) => entry.productId === pick.productId)) || group.choices[0];
        return { group: index, name: group.name, imagePath: choice?.imagePath ?? '', picked: !!pick };
      });
  });

  /**
   * The picked pieces as bag lines (a piece whose size is still open is priced without one), and
   * the group of each line, and whether it is already in the bag.
   */
  #draftLines(strict: boolean): { lines: CartLineDraft[]; groups: number[]; inBag: boolean[] } | null {
    const lines: CartLineDraft[] = [];
    const groups: number[] = [];
    const inBag: boolean[] = [];
    const picks = this.#picks();
    for (let index = 0; index < picks.length; index++) {
      for (const pick of picks[index] ?? []) {
        const choice = this.#choice(index, pick.productId);
        if (!choice) {
          if (strict) return null;
          continue;
        }
        const line = bundlePieceLine(choice, pick);
        if (!line && strict) return null;
        lines.push(line ?? { productId: choice.product.id, variantId: null, selection: {}, quantity: 1 });
        groups.push(index);
        inBag.push(pick.inBag === true);
      }
    }
    return { lines, groups, inBag };
  }

  /** The picked pieces priced by the bag's own `priceBag()`. */
  readonly #totals = computed<BundleTotals>(() => {
    const draft = this.#draftLines(false);
    const lists = this.#choiceLists();
    if (!draft || !lists || draft.lines.length === 0) return { normal: 0, total: 0 };
    const priced = priceBag(draft.lines, this.#pricingProducts(), this.#offers(), this.#pricingCtx());
    let normal = 0;
    let total = 0;
    for (const line of priced.lines) {
      if (!line) continue;
      normal += line.fullEgp;
      total += line.lineEgp;
    }
    return { normal, total };
  });

  /**
   * What Add Bundle to Bag adds: one line per piece not already in the bag (`?from=bag`), or null
   * while anything is open.
   */
  readonly #bundleLines = computed(() => {
    if (this.action().kind !== 'add') return null;
    const draft = this.#draftLines(true);
    if (!draft) return null;
    return draft.lines.filter((_, n) => !draft.inBag[n]);
  });

  /** Every piece is picked (never while the products are loading or failed to load). */
  readonly complete = computed(() => this.#groups().length > 0 && this.#bundleLines() !== null);
  readonly normalPrice = computed(() => this.#money(this.#totals().normal));
  readonly bundlePrice = computed(() => this.#money(this.#totals().total));
  readonly youSave = computed(() => {
    const totals = this.#totals();
    return totals.normal > totals.total ? this.#money(totals.normal - totals.total) : '';
  });

  /** "2 of 4 chosen" while products are still missing. */
  readonly progressText = computed(() => {
    const groups = this.#groups();
    const picks = this.#picks();
    const done = groups.filter((group, index) => groupComplete(group, picks[index] ?? [])).length;
    return done < groups.length ? `${done} of ${groups.length} chosen` : '';
  });

  constructor() {
    afterNextRender(() => this.#hydrated.set(true));

    if (isPlatformBrowser(this.#platformId)) {
      const timer = setInterval(() => this.#nowMs.set(Date.now()), 60_000);
      inject(DestroyRef).onDestroy(() => clearInterval(timer));
      afterNextRender(() => this.#nowMs.set(Date.now()));
    }

    effect(() => {
      const offer = this.offer();
      this.#seo.setPageMetadata(
        offer
          ? {
              title: `${offerTextFor(offer.title.trim(), this.#currency.selected()) || 'Bundle & Save'} | Atteya Store`,
              description: 'Pick one product from each group and add the whole bundle to your bag.',
              noindex: true,
            }
          : {
              title:
                this.page().status === 'missing'
                  ? 'Page Not Found | Atteya Store'
                  : 'Bundle & Save | Atteya Store',
              description: 'This bundle is not available.',
              noindex: true,
            },
      );
    });

    // From the bag: once the picks start, scroll to the first group still missing a piece.
    effect(() => {
      const offerId = this.#offerId();
      if (this.from() !== 'bag' || this.#scrolledFor === offerId || this.#picksKey() === '') return;
      this.#scrolledFor = offerId;
      const group = untracked(() => firstOpenGroup(this.#groups(), this.#picks()));
      afterNextRender({ write: () => this.#scrollTo(group, false) }, { injector: this.#injector });
    });
  }

  #money(egp: number): string {
    const entry = this.#currency.entry();
    return formatMoney(toDisplayAmount(egp, entry), entry.code, displayDecimals(entry.code));
  }

  #scrollTo(group: number, focus: boolean): void {
    const element = this.#host.nativeElement.querySelector<HTMLElement>(`[data-bundle-group="${group}"]`);
    if (!element) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    if (focus)
      element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  /** The row's button, so the panel can hand focus back to it. */
  #rowButton(group: number, piece: number): HTMLElement | null {
    return this.#host.nativeElement.querySelector<HTMLElement>(
      `[data-bundle-piece="${group}:${piece}"] button:not(:disabled)`,
    );
  }

  /** The first row that still needs a product or a size, at or after a group. */
  #nextOpenRow(fromGroup: number): PieceRow | null {
    return (
      this.rows().find((row) => row.mode === 'choose' && row.group >= fromGroup && !row.view?.done) ?? null
    );
  }

  /**
   * Opens the choice panel (the product page's, ATS-349) for one piece: a side panel on desktop, a
   * sheet from the bottom on phone and tablet. "Next" moves on to the following piece still missing.
   */
  async open(group: number, piece: number, trigger: HTMLElement | null): Promise<void> {
    const facts = this.#groups()[group];
    const groupPicks = this.#picks()[group] ?? [];
    if (!facts || this.soldOut()) return;
    // Pieces of a group fill in order: an empty "Balls 3" row picks the group's next empty piece.
    const at = Math.min(piece, groupPicks.length);
    const rows = this.rows().filter((row) => row.mode === 'choose');
    const index = rows.findIndex((row) => row.group === group && row.piece === at);
    const row = rows[index];
    if (!row?.view) return;
    const next = rows.slice(index + 1).find((entry) => !entry.view?.done) ?? null;
    const pick = groupPicks[at] ?? null;
    let result: Awaited<ReturnType<ChoicePickerService['open']>>;
    try {
      result = await this.#picker.open(
        {
          choices: facts.choices,
          title: row.title,
          step: `Bundle & Save · ${index + 1} of ${rows.length}`,
          pick: pick ? { productId: pick.productId, sizeId: row.view.sizeId } : null,
          next: next?.title ?? null,
          hint: 'Tap a photo to pick this piece.',
        },
        trigger,
      );
    } catch {
      // The panel couldn't open: the row stays as it was and the shopper can tap it again.
      return;
    }
    if (!result) return;
    const { productId, sizeId } = result;
    this.#picks.update((all) =>
      all.map((picks, n) => (n === group ? setPiecePick(facts, picks, at, productId, sizeId) : picks)),
    );
    if (result.next && next) await this.open(next.group, next.piece, this.#rowButton(next.group, next.piece));
  }

  /** The one button: opens the next thing to choose, or adds the whole bundle and opens the bag. */
  next(): void {
    const action = this.action();
    if (action.kind !== 'add') {
      const row = this.#nextOpenRow(action.group);
      if (row) void this.open(row.group, row.piece, this.#rowButton(row.group, row.piece));
      else this.#scrollTo(action.group, true);
      return;
    }
    const lines = this.#bundleLines();
    if (!lines || this.soldOut()) return;
    if (lines.length === 0) {
      // Every piece is already in the bag: show it there.
      this.#drawer.open('cart');
      return;
    }
    if (!this.#cart.addAll(lines)) {
      this.#snackbar.error('Your bag is full. Remove an item to add these.');
      return;
    }
    this.#pixel.trackAddToCart(lines);
    this.#snackbar.success('Added to your bag');
    this.#drawer.open('cart');
  }
}
