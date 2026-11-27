import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser, NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LinkTargetPipe } from '@shared/pipes/link-target.pipe';
import type { gsap as GsapNamespace } from 'gsap';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { SkeletonComponent } from '@shared/ui/skeleton';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { normalizeImageKitPath } from '@shared/utils/image';
import { CatalogService } from '@core/services/products/catalog.service';
import { catalogPathIsEmpty } from '@core/services/products/utils/catalog-path';
import { NAV_LIST_MAX_ITEMS } from '../../data/home.data';
import { HomeNavList, HomeNavListItem } from '../../models/home.model';
import {
  pendingNavListImage,
  playNavListArrows,
  settleNavListArrows,
} from '../../utils/navigation-list-motion';

type GsapApi = typeof GsapNamespace;
type GsapContext = ReturnType<GsapApi['context']>;

/** Longest wait for an incoming photo before the swap plays anyway. */
const PHOTO_WAIT_MS = 1200;

let nextTitleId = 0;

@Component({
  selector: 'app-navigation-list-section',
  host: {
    class: 'block w-full',
  },
  templateUrl: './navigation-list-section.component.html',
  styleUrl: './navigation-list-section.component.scss',
  imports: [
    RouterLink,
    LinkTargetPipe,
    NgOptimizedImage,
    NgTemplateOutlet,
    AppImageFallbackDirective,
    SkeletonComponent,
    SharedIconModule,
  ],
})
export class NavigationListSectionComponent {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #catalog = inject(CatalogService);
  readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly navList = input.required<HomeNavList>();
  readonly isLoading = input<boolean>(false);
  readonly previewMode = input<boolean>(false);
  readonly activeItemIndex = input<number>(0);

  readonly itemSelect = output<number>();

  readonly titleId = `nav-list-title-${++nextTitleId}`;

  /** False on the server and through the hydration render; true after the first browser render. */
  readonly #rendered = signal(false);

  /**
   * The saved list as staff entered it (admin preview), or for shoppers the same
   * list without links to a category or brand that has nothing published. The
   * check is the one the menus use (`CatalogService.isEmpty`), which keeps every
   * link while the catalogue counts are missing or still loading.
   *
   * Until the first browser render finishes, only the seed taxonomy counts as
   * known (the live category and brand lists are empty during SSR), so the
   * hydration render matches the server HTML. The live lists apply afterwards.
   */
  readonly items = computed(() => {
    const saved = this.navList().items.slice(0, NAV_LIST_MAX_ITEMS);
    if (this.previewMode()) return saved;
    if (!this.#rendered()) {
      const summary = this.#catalog.summary();
      if (!summary) return saved;
      return saved.filter((item) => !catalogPathIsEmpty(summary, item.link));
    }
    return saved.filter((item) => !this.#catalog.isEmpty(item.link));
  });
  readonly title = computed(() => this.navList().title.trim() || 'Shop by category');

  readonly #activeIndex = linkedSignal<number | null, number>({
    source: () => (this.previewMode() ? this.#clamp(this.activeItemIndex()) : null),
    computation: (edited, previous) => {
      if (edited !== null) return edited;
      return this.#clamp(previous?.value ?? 0);
    },
  });

  readonly activeIndex = computed(() => this.#clamp(this.#activeIndex()));

  /**
   * Becomes true on the shopper's first hover or keyboard focus on a row (ATS-360). Until then
   * no row shows the active line or arrow; the photo panel still shows the first category.
   */
  readonly #touched = signal(false);

  /** The row that shows the active line and arrow, or -1 before the shopper touches the list. */
  readonly highlightIndex = computed(() => (this.previewMode() || this.#touched() ? this.activeIndex() : -1));

  /**
   * The photo on top of the desktop stack (ATS-361). It follows `activeIndex()` once the
   * incoming photo has downloaded (1.2 s at most), so the stack never brings an empty frame up.
   */
  readonly #shownIndex = signal(0);
  readonly shownIndex = computed(() => this.#clamp(this.#shownIndex()));

  /** "01 / 07" on the top photo. */
  readonly position = computed(() => {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(this.shownIndex() + 1)} / ${pad(this.items().length)}`;
  });

  /**
   * The top photo and the two behind it mount with the desktop panel (ATS-361), and the two
   * behind any photo coming to the top mount before it moves. The rest mount on the first
   * pointer or focus. Mounted photos stay, so they slide away instead of vanishing.
   */
  readonly #mounted = signal<ReadonlySet<number>>(new Set([0, 1, 2]));
  readonly #loaded = signal<ReadonlySet<number>>(new Set());
  /** False until the stack shows its first photo; that first one goes up with no wait. */
  #photosSettled = false;
  /**
   * Stays false until the browser confirms the lg layout. Starting false keeps
   * the photo out of the server HTML and the first client render, so a phone
   * never requests it before the layout is known.
   */
  readonly #desktopPhotos = signal(false);
  readonly #motionReady = signal(false);

  readonly showPhotos = this.#desktopPhotos.asReadonly();

  #gsap: GsapApi | null = null;
  #ctx: GsapContext | null = null;
  #desktopQuery: MediaQueryList | null = null;
  #reduceQuery: MediaQueryList | null = null;
  #reduceMotion = false;
  #destroyed = false;
  #lastArrow = -1;
  #arrowsSettled = false;
  #cancelPhotoWait: (() => void) | null = null;

  constructor() {
    afterNextRender(() => {
      this.#rendered.set(true);
      this.#bootBrowser();
    });

    // CSS moves the photos (no GSAP), so this runs before GSAP has loaded too.
    afterRenderEffect(() => {
      const index = this.activeIndex();
      const photosEnabled = this.#desktopPhotos();
      const mounted = this.#mounted();
      if (!photosEnabled) return;
      // The admin preview can pick a row whose photo is not in the page yet: add it and
      // the two that will sit behind it, then come back.
      const count = this.items().length;
      const around = [index, (index + 1) % count, (index + 2) % count].filter((i) => i < count);
      if (around.some((i) => !mounted.has(i))) {
        untracked(() => around.forEach((i) => this.#mount(i)));
        return;
      }
      untracked(() => this.#syncPhotos(index));
    });

    // The arrow follows the highlighted row straight away, even while the photo
    // waits for its download. Before the first hover or focus it shows no arrow (ATS-360).
    afterRenderEffect(() => {
      const index = this.highlightIndex();
      const ready = this.#motionReady();
      const desktop = this.#desktopPhotos();
      this.items();
      if (!ready || !desktop) return;
      untracked(() => this.#syncArrows(index));
    });

    inject(DestroyRef).onDestroy(() => this.#teardown());
  }

  imagePath(item: HomeNavListItem): string | null {
    const path = normalizeImageKitPath(item.imageUrl);
    if (!path || path === 'hero/default-hero.jpg') return null;
    return path;
  }

  isMounted(index: number): boolean {
    return this.#mounted().has(index);
  }

  /** True once photo `index` has downloaded; the photos behind the top one wait for it. */
  isLoaded(index: number): boolean {
    return this.#loaded().has(index);
  }

  markLoaded(index: number): void {
    this.#loaded.update((current) => {
      if (current.has(index)) return current;
      const next = new Set(current);
      next.add(index);
      return next;
    });
  }

  /** Place in the desktop stack: 0 is the top photo, 1 and 2 peek out behind it, the rest are hidden. */
  depthOf(index: number): number {
    const count = this.items().length;
    if (count <= 0) return 0;
    return (index - this.shownIndex() + count) % count;
  }

  isEdited(index: number): boolean {
    return this.previewMode() && this.activeItemIndex() === index;
  }

  mountRemaining(): void {
    if (!this.#desktopPhotos()) return;
    const count = this.items().length;
    this.#mounted.update((current) => {
      if (current.size >= count) return current;
      return new Set(Array.from({ length: count }, (_, index) => index));
    });
  }

  /**
   * `mark` is false for a touch or pen pointer, so a tap on a wide touch screen opens the link
   * instead of first drawing the row's line and arrow (which iOS treats as a hover and eats the tap).
   */
  activate(index: number, mark = true): void {
    const next = this.#clamp(index);
    if (mark) this.#touched.set(true);
    if (this.#desktopPhotos()) this.#mount(next);
    if (this.#activeIndex() === next) return;
    this.#activeIndex.set(next);
  }

  selectItem(index: number): void {
    this.activate(index);
    this.itemSelect.emit(index);
  }

  #mount(index: number): void {
    this.#mounted.update((current) => {
      if (current.has(index)) return current;
      const next = new Set(current);
      next.add(index);
      return next;
    });
  }

  #clamp(index: number): number {
    const count = this.items().length;
    if (count <= 0) return 0;
    if (index < 0) return 0;
    if (index >= count) return count - 1;
    return index;
  }

  #bootBrowser(): void {
    const desktop = window.matchMedia('(min-width: 1024px)');
    this.#desktopPhotos.set(desktop.matches);
    desktop.addEventListener('change', this.#onDesktopChange);
    this.#desktopQuery = desktop;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.#reduceMotion = reduce.matches;
    reduce.addEventListener('change', this.#onReduceChange);
    this.#reduceQuery = reduce;

    void import('gsap')
      .then(({ gsap }) => {
        if (this.#destroyed) return;
        this.#gsap = gsap;
        this.#ctx = gsap.context(() => undefined, this.#host.nativeElement);
        this.#motionReady.set(true);
      })
      .catch(() => {
        // CSS keeps the first photo visible when animation cannot start.
      });
  }

  readonly #onDesktopChange = (event: MediaQueryListEvent): void => {
    this.#desktopPhotos.set(event.matches);
    if (event.matches) return;
    this.#stopPhotoWait();
    this.#photosSettled = false;
    this.#arrowsSettled = false;
    this.#ctx?.revert();
    if (this.#gsap) {
      this.#ctx = this.#gsap.context(() => undefined, this.#host.nativeElement);
    }
  };

  readonly #onReduceChange = (event: MediaQueryListEvent): void => {
    this.#reduceMotion = event.matches;
    if (!event.matches) return;
    this.#arrowsSettled = false;
    this.#syncArrows(this.highlightIndex());
  };

  #syncArrows(index: number): void {
    const gsap = this.#gsap;
    const ctx = this.#ctx;
    if (!gsap || !ctx || !this.#desktopPhotos()) return;

    const arrows = [...this.#host.nativeElement.querySelectorAll<HTMLElement>('[data-nav-arrow]')];
    if (arrows.length === 0) return;

    const first = !this.#arrowsSettled;
    this.#arrowsSettled = true;
    if (!first && this.#lastArrow === index) {
      // Same row, but the list may have new rows (admin preview edits).
      ctx.add(() => settleNavListArrows(gsap, arrows, index));
      return;
    }
    this.#lastArrow = index;
    ctx.add(() => {
      if (first) {
        settleNavListArrows(gsap, arrows, index);
        return;
      }
      playNavListArrows(gsap, arrows, index, this.#reduceMotion);
    });
  }

  /**
   * Brings photo `index` to the top of the stack. A photo that is still downloading
   * waits (1.2 s at most), so the stack never slides an empty frame to the top.
   */
  #syncPhotos(index: number, skipWait = false): void {
    if (!this.#desktopPhotos()) return;
    const first = !this.#photosSettled;
    this.#photosSettled = true;
    if (this.shownIndex() === index) {
      this.#stopPhotoWait();
      return;
    }
    this.#stopPhotoWait();
    if (!skipWait && !first) {
      const photos = [...this.#host.nativeElement.querySelectorAll<HTMLElement>('[data-nav-photo]')];
      const pending = pendingNavListImage(photos, index);
      if (pending) {
        this.#waitForPhoto(pending, index);
        return;
      }
    }
    this.#shownIndex.set(index);
  }

  #waitForPhoto(img: HTMLImageElement, index: number): void {
    const play = (): void => {
      this.#stopPhotoWait();
      if (this.#destroyed || this.activeIndex() !== index) return;
      this.#syncPhotos(index, true);
    };
    // After an ImageKit error the fallback directive (its listener runs
    // first) retries the Storage URL on the same <img>, so `complete` is
    // false again and we keep waiting. A second error leaves it complete:
    // the photo has finally failed, so swap now. The timer covers a photo
    // that never arrives.
    const onError = (): void => {
      if (img.complete) play();
    };
    img.addEventListener('load', play);
    img.addEventListener('error', onError);
    const timer = setTimeout(play, PHOTO_WAIT_MS);
    this.#cancelPhotoWait = () => {
      img.removeEventListener('load', play);
      img.removeEventListener('error', onError);
      clearTimeout(timer);
    };
  }

  #stopPhotoWait(): void {
    this.#cancelPhotoWait?.();
    this.#cancelPhotoWait = null;
  }

  #teardown(): void {
    this.#stopPhotoWait();
    this.#destroyed = true;
    this.#desktopQuery?.removeEventListener('change', this.#onDesktopChange);
    this.#reduceQuery?.removeEventListener('change', this.#onReduceChange);
    this.#ctx?.revert();
    this.#ctx = null;
  }
}
