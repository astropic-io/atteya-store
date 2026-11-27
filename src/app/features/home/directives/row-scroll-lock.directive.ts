import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import type { gsap as GsapNamespace } from 'gsap';
import type { ScrollTrigger as ScrollTriggerClass } from 'gsap/ScrollTrigger';
import { rowItemTarget, scrollRowByItem } from '@shared/utils/row-scroll.utils';

type GsapApi = typeof GsapNamespace;
type GsapMatchMedia = ReturnType<GsapApi['matchMedia']>;
type ScrollTriggerApi = typeof ScrollTriggerClass;

/** Desktop with a mouse or trackpad, and motion allowed. Phones, tablets and reduced motion never lock. */
const LOCK_QUERY =
  '(min-width: 1024px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
/** Sticky desktop nav (`h-14`). The section only locks when it fits fully below it. */
const STICKY_BAR_PX = 56;
/** Rows that can move less than this don't lock. */
const MIN_TRAVEL_PX = 2;
/** Photos are never shrunk below this to make a section fit; such a section doesn't lock. */
const MIN_FIT_MEDIA_PX = 160;
/** Set on the section: the photo height that makes the whole section fit while locked. */
const FIT_MEDIA_VAR = '--row-lock-media-max';
/** Skip a row write this close to the page-driven position (keeps native trackpad scrolling smooth). */
const SYNC_TOLERANCE_PX = 3;
const REFRESH_DELAY_MS = 200;
/** Scroll positions this close to an end count as being at that end (sub-pixel rounding). */
const EDGE_PX = 2;
/** Pixels a swipe or mouse drag must cover, at the first or last card, to wrap to the other end. */
const WRAP_PX = 40;
/** Quiet time with no scroll events before a swipe wrap starts, so the edge bounce is over. */
const SETTLE_MS = 120;

/**
 * Home product rows (New Arrivals, Padel): on desktop, once the whole section is
 * in view, the section stays in place while page scrolling moves through the
 * cards (GSAP ScrollTrigger scrub). After the last card the page carries on.
 *
 * Put it on the `.scroll-row` element inside the section's `<section>`; the
 * section's parent (the component host) gets a spacer that supplies the scroll
 * distance. The lock is CSS `position: sticky`, not ScrollTrigger's fixed pin:
 * `<main>` is an `@container`, which makes it the containing block for fixed
 * elements, and a pin would also move Angular-owned nodes into a wrapper.
 *
 * A section taller than the window (New Arrivals on a laptop) can still lock:
 * give `rowLockFit` the selector of its card photos. The directive measures
 * everything else in the section and sets `--row-lock-media-max` (px) on the
 * section; the section's CSS caps the photos' height with it, so the heading,
 * cards and arrows all fit below the nav.
 *
 * Wherever the lock is off (phones, tablets, reduced motion, a section that
 * doesn't fit), the row loops instead: next on the last card goes back to the
 * first, previous on the first goes to the last (arrows, touch swipe and mouse
 * drag alike), the same way the product page photos loop.
 */
@Directive({
  selector: '[appRowScrollLock]',
  exportAs: 'rowScrollLock',
})
export class RowScrollLockDirective {
  readonly #row = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly #destroyRef = inject(DestroyRef);
  readonly #enabled = signal(false);
  /** The desktop check has run (or GSAP failed to load), so `enabled` is final for now. */
  readonly #decided = signal(false);

  /** Selector of the photos that shrink so the section fits the window while locked. */
  readonly rowLockFit = input<string | null>(null);

  /** True while the desktop lock is set up (the page scroll drives the row). */
  readonly enabled = this.#enabled.asReadonly();

  /** The row loops at its ends: true whenever the desktop lock is off. */
  readonly loops = computed(() => this.#decided() && !this.#enabled());

  #mm: GsapMatchMedia | null = null;
  #trigger: ScrollTriggerClass | null = null;
  #travel = 0;
  #destroyed = false;
  /** Touch or mouse press in progress, to wrap when it pushes past the first or last card. */
  #press: { x: number; y: number; atStart: boolean; atEnd: boolean } | null = null;
  /** Stops a pending swipe wrap (waiting for the edge bounce to finish). */
  #cancelSettle: (() => void) | null = null;

  constructor() {
    if (!this.#isBrowser) return;
    afterNextRender(() => {
      void this.#boot();
      this.#watchWrap();
    });
    this.#destroyRef.onDestroy(() => {
      this.#destroyed = true;
      this.#cancelSettle?.();
      this.#mm?.revert();
      this.#mm = null;
    });
  }

  /**
   * Arrow buttons. While locked, scroll the page to the card's position so the
   * page and the row stay in step; otherwise scroll the row itself. Where the
   * lock is off, next on the last card goes to the first and previous on the
   * first goes to the last.
   */
  step(direction: 1 | -1): void {
    const trigger = this.#trigger;
    if (trigger && this.#travel > 0 && this.#inRange(trigger)) {
      const target = rowItemTarget(this.#row, direction);
      window.scrollTo({ top: trigger.start + target, behavior: 'smooth' });
      return;
    }
    if (this.loops() && this.#wrap(direction)) return;
    scrollRowByItem(this.#row, direction);
  }

  /** At the last card going forward (or the first going back): jump to the other end. */
  #wrap(direction: 1 | -1): boolean {
    const row = this.#row;
    if (this.#lastLeft() <= EDGE_PX) return false;
    // Reduced motion: jump, don't sweep across every card.
    const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'instant'
      : 'smooth';
    if (direction === 1 && this.#atEnd()) {
      row.scrollTo({ left: 0, behavior });
      return true;
    }
    if (direction === -1 && this.#atStart()) {
      row.scrollTo({ left: this.#lastLeft(), behavior });
      return true;
    }
    return false;
  }

  /**
   * Native swiping and the mouse drag stop at the ends. A clear sideways swipe or drag that
   * starts at the last card and pushes on (or at the first card and pulls back) wraps around.
   */
  #watchWrap(): void {
    const row = this.#row;
    const start = (x: number, y: number): void => {
      // A new touch takes over from a wrap still waiting to start.
      this.#cancelSettle?.();
      this.#press =
        this.loops() && this.#lastLeft() > EDGE_PX
          ? { x, y, atStart: this.#atStart(), atEnd: this.#atEnd() }
          : null;
    };
    const end = (x: number, y: number): void => {
      const press = this.#press;
      this.#press = null;
      if (!press || !this.loops()) return;
      const dx = x - press.x;
      const dy = y - press.y;
      if (Math.abs(dx) < WRAP_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const direction = dx < 0 ? 1 : -1;
      if (direction === 1 ? !(press.atEnd && this.#atEnd()) : !(press.atStart && this.#atStart())) return;
      // Wait for the edge bounce (iOS) to finish: a scroll started during it is dropped.
      this.#afterScrollSettles(() => this.#wrap(direction));
    };

    // Passive listeners so native swiping is never held up.
    const onTouchStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) {
        this.#press = null;
        return;
      }
      start(touch.clientX, touch.clientY);
    };
    const onTouchEnd = (event: TouchEvent): void => {
      const touch = event.changedTouches[0];
      if (touch) end(touch.clientX, touch.clientY);
      else this.#press = null;
    };
    const onCancel = (): void => {
      this.#press = null;
    };
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      start(event.clientX, event.clientY);
      window.addEventListener('mouseup', onMouseUp, { once: true });
    };
    const onMouseUp = (event: MouseEvent): void => end(event.clientX, event.clientY);

    row.addEventListener('touchstart', onTouchStart, { passive: true });
    row.addEventListener('touchend', onTouchEnd, { passive: true });
    row.addEventListener('touchcancel', onCancel, { passive: true });
    row.addEventListener('mousedown', onMouseDown, { passive: true });
    this.#destroyRef.onDestroy(() => {
      row.removeEventListener('touchstart', onTouchStart);
      row.removeEventListener('touchend', onTouchEnd);
      row.removeEventListener('touchcancel', onCancel);
      row.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    });
  }

  /** Runs `done` once the row has had no scroll events for SETTLE_MS. */
  #afterScrollSettles(done: () => void): void {
    const row = this.#row;
    this.#cancelSettle?.();
    let timer = 0;
    const stop = (): void => {
      clearTimeout(timer);
      row.removeEventListener('scroll', restart);
      this.#cancelSettle = null;
    };
    const restart = (): void => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        stop();
        done();
      }, SETTLE_MS);
    };
    row.addEventListener('scroll', restart, { passive: true });
    this.#cancelSettle = stop;
    restart();
  }

  #lastLeft(): number {
    return Math.max(0, this.#row.scrollWidth - this.#row.clientWidth);
  }

  #atStart(): boolean {
    return this.#row.scrollLeft <= EDGE_PX;
  }

  #atEnd(): boolean {
    return this.#row.scrollLeft >= this.#lastLeft() - EDGE_PX;
  }

  async #boot(): Promise<void> {
    try {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')]);
      if (this.#destroyed) return;
      gsap.registerPlugin(ScrollTrigger);
      this.#mm = gsap.matchMedia();
      this.#mm.add(LOCK_QUERY, () => this.#lock(ScrollTrigger));
    } catch {
      // No lock: normal page scroll, arrows and drag still work (and the row loops).
    }
    if (!this.#destroyed) this.#decided.set(true);
  }

  #inRange(trigger: ScrollTriggerClass): boolean {
    const y = trigger.scroll();
    return y >= trigger.start && y <= trigger.end;
  }

  #lock(ScrollTrigger: ScrollTriggerApi): (() => void) | undefined {
    const row = this.#row;
    const section = row.closest('section');
    const host = section?.parentElement;
    if (!section || !host) return undefined;

    const spacer = document.createElement('div');
    spacer.setAttribute('aria-hidden', 'true');
    host.insertBefore(spacer, section.nextSibling);

    let lastSet = -1;
    /** Page position last set from the row (drag, swipe): that update must not move the row back. */
    let rowDrivenY = -1;
    /** The shopper moved the row (arrows, drag, swipe) while the page was outside the lock. */
    let movedOutside = false;
    let wasActive = false;

    const available = (): number => window.innerHeight - STICKY_BAR_PX;

    // Shrink the photos just enough that the whole section fits below the nav.
    // Everything except the photo keeps its height (the card width doesn't change),
    // so this settles in one pass.
    const fitMedia = (scrolls: boolean): void => {
      const selector = this.rowLockFit();
      if (!selector) return;
      const media = scrolls ? section.querySelector<HTMLElement>(selector) : null;
      if (!media) {
        section.style.removeProperty(FIT_MEDIA_VAR);
        return;
      }
      const chrome = section.offsetHeight - media.offsetHeight;
      const max = Math.floor(available() - chrome);
      if (max >= MIN_FIT_MEDIA_PX) section.style.setProperty(FIT_MEDIA_VAR, `${max}px`);
      else section.style.removeProperty(FIT_MEDIA_VAR);
    };

    const measure = (): void => {
      const max = row.scrollWidth - row.clientWidth;
      fitMedia(max > MIN_TRAVEL_PX);
      const height = section.offsetHeight;
      const fits = height <= available();
      this.#travel = fits && max > MIN_TRAVEL_PX ? max : 0;
      const locks = this.#travel > 0;
      spacer.style.height = `${this.#travel}px`;
      // Stays put from the moment its bottom edge reaches the bottom of the window.
      section.style.position = locks ? 'sticky' : '';
      section.style.top = locks ? `${window.innerHeight - height}px` : '';
      // While it locks, the page sets the row position frame by frame: no snapping or
      // smoothing on top. A row that doesn't lock keeps its normal card snapping.
      row.style.scrollSnapType = locks ? 'none' : '';
      row.style.scrollBehavior = locks ? 'auto' : '';
      this.#enabled.set(locks);
    };
    measure();

    const trigger = ScrollTrigger.create({
      trigger: spacer,
      start: 'top bottom',
      end: 'bottom bottom',
      onRefreshInit: measure,
      onUpdate: (self) => {
        if (this.#travel <= 0) return;
        const entering = self.isActive && !wasActive;
        wasActive = self.isActive;
        if (entering && movedOutside) {
          // Keep the cards where the shopper left them: move the page to match instead.
          movedOutside = false;
          rowDrivenY = Math.round(self.start + row.scrollLeft);
          lastSet = row.scrollLeft;
          window.scrollTo({ top: rowDrivenY, behavior: 'instant' });
          return;
        }
        if (Math.abs(self.scroll() - rowDrivenY) < 1) return;
        const target = self.progress * this.#travel;
        const edge = self.progress === 0 || self.progress === 1;
        if (edge || Math.abs(row.scrollLeft - target) > SYNC_TOLERANCE_PX) {
          lastSet = target;
          row.scrollLeft = target;
        }
      },
    });
    this.#trigger = trigger;

    // Drag or a sideways trackpad swipe while locked: move the page to match the row.
    const onRowScroll = (): void => {
      if (this.#travel <= 0) return;
      if (Math.abs(row.scrollLeft - lastSet) <= 1) return;
      if (!this.#inRange(trigger)) {
        movedOutside = true;
        return;
      }
      lastSet = row.scrollLeft;
      rowDrivenY = Math.round(trigger.start + row.scrollLeft);
      window.scrollTo({ top: rowDrivenY, behavior: 'instant' });
    };
    row.addEventListener('scroll', onRowScroll, { passive: true });

    // Cards, photos and sections above can change size after load: recalculate.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => ScrollTrigger.refresh(), REFRESH_DELAY_MS);
    };
    const resizeObserver = new ResizeObserver(scheduleRefresh);
    resizeObserver.observe(document.body);
    resizeObserver.observe(section);
    const mutationObserver = new MutationObserver(scheduleRefresh);
    mutationObserver.observe(row, { childList: true });

    return () => {
      if (timer) clearTimeout(timer);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      row.removeEventListener('scroll', onRowScroll);
      spacer.remove();
      section.style.position = '';
      section.style.top = '';
      section.style.removeProperty(FIT_MEDIA_VAR);
      row.style.scrollSnapType = '';
      row.style.scrollBehavior = '';
      this.#trigger = null;
      this.#travel = 0;
      this.#enabled.set(false);
    };
  }
}
