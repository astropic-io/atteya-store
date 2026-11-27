import { NgOptimizedImage } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { PDP_GALLERY_SIZES } from '@core/image/image-kit.loader';
import type { ProductImage } from '@core/services/products';
import { AppImageFallbackDirective } from '@shared/directives/image-fallback';
import { SharedIconModule } from '@shared/ui/mat-icon';
import { normalizeImageKitPath } from '@shared/utils/image';

/** Pixels the mouse must move before a press becomes a drag. */
const DRAG_START_PX = 4;
/** Share of a photo's width a drag must cover to move to the next photo. */
const DRAG_FLIP_RATIO = 0.15;
const DRAGGING_CLASS = 'pdp-gallery-track--dragging';
/** Pixels a swipe must cover, at the first or last photo, to wrap around to the other end. */
const SWIPE_WRAP_PX = 40;
/** Scroll positions this close to an end count as being at that end (sub-pixel rounding). */
const EDGE_PX = 2;
/** Quiet time with no scroll events before a swipe wrap starts, so the edge bounce is over. */
const SETTLE_MS = 120;

/**
 * Product photos in a native scroll-snap row: swipe on touch, drag with a mouse, arrows and a
 * "1/6" counter centred under the photos. Vertical wheel scrolling is left to the page.
 * The photos loop: next on the last photo goes back to the first, previous on the first goes to
 * the last (arrows, mouse drag and touch swipe alike).
 */
@Component({
  selector: 'app-product-gallery',
  imports: [NgOptimizedImage, AppImageFallbackDirective, SharedIconModule, MatButtonModule],
  templateUrl: './product-gallery.component.html',
  host: { class: 'block w-full' },
})
export class ProductGalleryComponent {
  readonly images = input.required<readonly ProductImage[]>();
  readonly name = input.required<string>();
  readonly activeColourImage = input<ProductImage | null>(null);

  readonly path = normalizeImageKitPath;
  readonly sizes = PDP_GALLERY_SIZES;

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  #frame = 0;
  /** Mouse drag in progress; null when the mouse is up (touch uses native swiping). */
  #drag: { pointerId: number; startX: number; startLeft: number; moved: boolean } | null = null;
  /** Touch in progress, to wrap around when a swipe pushes past the first or last photo. */
  #touch: { x: number; y: number; atStart: boolean; atEnd: boolean } | null = null;
  /** Stops a pending swipe wrap (waiting for the edge bounce to finish). */
  #cancelSettle: (() => void) | null = null;

  readonly displayImages = computed<readonly ProductImage[]>(() => {
    const colourImg = this.activeColourImage();
    const base = this.images();
    if (!colourImg) return base;
    return [colourImg, ...base.filter((img) => img.path !== colourImg.path)];
  });

  /** Index of the first photo in view. Back to 0 when the photo list changes (another colour). */
  readonly active = linkedSignal({ source: this.displayImages, computation: () => 0 });

  /** Photos fully in view at once: 1, or 2 side by side on wide screens. */
  readonly perView = signal(1);

  /** Index of the last photo in view (screen readers hear "Photos 2 and 3 of 3"). */
  readonly lastShown = computed(() =>
    Math.min(this.active() + this.perView() - 1, Math.max(this.displayImages().length - 1, 0)),
  );

  /**
   * Counts positions, not photos: with two photos side by side, 4 photos are 3 positions
   * ("1/3" … "3/3"); one photo at a time, it is "1/4" … "4/4".
   */
  readonly counter = computed(() => {
    const positions = Math.max(1, this.displayImages().length - this.perView() + 1);
    return `${Math.min(this.active() + 1, positions)}/${positions}`;
  });

  /** What screen readers hear: "Photo 1 of 4" or "Photos 1 and 2 of 4". */
  readonly counterSpoken = computed(() => {
    const first = this.active() + 1;
    const last = this.lastShown() + 1;
    const total = this.displayImages().length;
    return last > first ? `Photos ${first} and ${last} of ${total}` : `Photo ${first} of ${total}`;
  });

  /** False when every photo already fits (nothing to move to); the arrows are then disabled. */
  readonly scrollable = linkedSignal({
    source: this.displayImages,
    computation: (images) => images.length > 1,
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.#sync();
      const el = this.track()?.nativeElement;
      if (!el) return;
      // Passive listeners so native swiping is never held up.
      const onTouchStart = (event: TouchEvent): void => this.#onTouchStart(event);
      const onTouchEnd = (event: TouchEvent): void => this.#onTouchEnd(event);
      const onTouchCancel = (): void => {
        this.#touch = null;
      };
      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchend', onTouchEnd, { passive: true });
      el.addEventListener('touchcancel', onTouchCancel, { passive: true });
      destroyRef.onDestroy(() => {
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchend', onTouchEnd);
        el.removeEventListener('touchcancel', onTouchCancel);
        this.#cancelSettle?.();
      });
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.#sync());
      observer.observe(el);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    destroyRef.onDestroy(() => {
      if (this.#frame) cancelAnimationFrame(this.#frame);
    });

    // A new colour puts its photo first: jump back to the start without animating.
    effect(() => {
      this.displayImages();
      untracked(() => {
        const el = this.track()?.nativeElement;
        if (el && typeof el.scrollTo === 'function') {
          el.scrollTo({ left: 0, behavior: 'instant' });
          // Already at 0 sends no scroll event: refresh the counter and arrows for the new photos.
          if (typeof requestAnimationFrame === 'function') {
            cancelAnimationFrame(this.#frame);
            this.#frame = requestAnimationFrame(() => this.#sync());
          }
        }
      });
    });
  }

  step(direction: 1 | -1): void {
    const el = this.track()?.nativeElement;
    if (!el) return;
    // Loop: past the last photo back to the first, before the first round to the last.
    if (direction === 1 && this.#atEnd(el)) {
      el.scrollTo({ left: 0 });
      return;
    }
    if (direction === -1 && this.#atStart(el)) {
      el.scrollTo({ left: this.#lastLeft(el) });
      return;
    }
    const last = this.displayImages().length - 1;
    const target = Math.min(Math.max(this.active() + direction, 0), last);
    el.scrollTo({ left: target * this.#stride(el) });
  }

  onScroll(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#sync());
  }

  onPointerDown(event: PointerEvent): void {
    const el = this.track()?.nativeElement;
    if (!el || event.pointerType !== 'mouse' || event.button !== 0) return;
    if (el.scrollWidth <= el.clientWidth) return;
    this.#drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeft: el.scrollLeft,
      moved: false,
    };
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.#drag;
    const el = this.track()?.nativeElement;
    if (!drag || !el || event.pointerId !== drag.pointerId) return;
    // Released outside the photos before the drag started: forget the press.
    if ((event.buttons & 1) === 0) {
      this.#drag = null;
      return;
    }
    const dx = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_START_PX) return;
      drag.moved = true;
      // Set straight on the element: snapping and smooth scrolling must be off before the next move.
      el.classList.add(DRAGGING_CLASS);
      el.setPointerCapture(drag.pointerId);
    }
    el.scrollLeft = drag.startLeft - dx;
  }

  onPointerEnd(event: PointerEvent): void {
    const drag = this.#drag;
    const el = this.track()?.nativeElement;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.#drag = null;
    if (!el || !drag.moved) return;

    if (el.hasPointerCapture(drag.pointerId)) el.releasePointerCapture(drag.pointerId);
    const stride = this.#stride(el);
    const startIndex = Math.round(drag.startLeft / stride);
    const dragged = drag.startLeft - el.scrollLeft;
    // At an end the row cannot scroll further, so the wrap reads how far the mouse moved.
    const pulled = event.clientX - drag.startX;
    // A short flick is enough to move one photo; a long drag lands on the nearest photo.
    let target = startIndex;
    const lastLeft = this.#lastLeft(el);
    el.classList.remove(DRAGGING_CLASS);
    if (Math.abs(pulled) >= stride * DRAG_FLIP_RATIO) {
      // Dragged on past the last photo, or back past the first: loop to the other end.
      if (pulled < 0 && drag.startLeft >= lastLeft - EDGE_PX) {
        el.scrollTo({ left: 0 });
        return;
      }
      if (pulled > 0 && drag.startLeft <= EDGE_PX) {
        el.scrollTo({ left: lastLeft });
        return;
      }
    }
    if (Math.abs(dragged) >= stride * DRAG_FLIP_RATIO) {
      const photos = Math.max(1, Math.round(Math.abs(dragged) / stride));
      target = startIndex + (dragged < 0 ? photos : -photos);
    }
    el.scrollTo({ left: Math.min(Math.max(target * stride, 0), lastLeft) });
  }

  imageAlt(image: ProductImage, index: number): string {
    const base = image.alt || this.name();
    return index === 0 ? base : `${base}, photo ${index + 1}`;
  }

  #sync(): void {
    const el = this.track()?.nativeElement;
    if (!el) return;
    const last = this.displayImages().length - 1;
    const stride = this.#stride(el);
    this.perView.set(Math.max(1, Math.round(el.clientWidth / stride)));
    const index = Math.round(el.scrollLeft / stride);
    this.active.set(Math.min(Math.max(index, 0), Math.max(last, 0)));
    this.scrollable.set(this.#lastLeft(el) > EDGE_PX);
  }

  #onTouchStart(event: TouchEvent): void {
    // A new touch takes over from a wrap still waiting to start.
    this.#cancelSettle?.();
    const el = this.track()?.nativeElement;
    const touch = event.touches[0];
    if (!el || !touch || event.touches.length > 1 || this.#lastLeft(el) <= EDGE_PX) {
      this.#touch = null;
      return;
    }
    this.#touch = {
      x: touch.clientX,
      y: touch.clientY,
      atStart: this.#atStart(el),
      atEnd: this.#atEnd(el),
    };
  }

  /**
   * Native swiping stops at the ends. A clear sideways swipe that starts at the last photo and
   * pushes on (or at the first photo and pulls back) wraps around to the other end.
   */
  #onTouchEnd(event: TouchEvent): void {
    const start = this.#touch;
    this.#touch = null;
    const el = this.track()?.nativeElement;
    const touch = event.changedTouches[0];
    if (!start || !el || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_WRAP_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const toStart = dx < 0 && start.atEnd && this.#atEnd(el);
    const toEnd = dx > 0 && start.atStart && this.#atStart(el);
    if (!toStart && !toEnd) return;
    // Wait for the edge bounce (iOS) to finish: a scroll started during it is dropped.
    this.#afterScrollSettles(el, () => el.scrollTo({ left: toStart ? 0 : this.#lastLeft(el) }));
  }

  /** Runs `done` once the row has had no scroll events for SETTLE_MS. */
  #afterScrollSettles(el: HTMLElement, done: () => void): void {
    this.#cancelSettle?.();
    let timer = 0;
    const stop = (): void => {
      clearTimeout(timer);
      el.removeEventListener('scroll', restart);
      this.#cancelSettle = null;
    };
    const restart = (): void => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        stop();
        done();
      }, SETTLE_MS);
    };
    el.addEventListener('scroll', restart, { passive: true });
    this.#cancelSettle = stop;
    restart();
  }

  #lastLeft(el: HTMLElement): number {
    return Math.max(0, el.scrollWidth - el.clientWidth);
  }

  #atStart(el: HTMLElement): boolean {
    return el.scrollLeft <= EDGE_PX;
  }

  #atEnd(el: HTMLElement): boolean {
    return el.scrollLeft >= this.#lastLeft(el) - EDGE_PX;
  }

  /** Width of one photo plus the gap after it. */
  #stride(el: HTMLElement): number {
    const first = el.firstElementChild as HTMLElement | null;
    if (!first) return el.clientWidth || 1;
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
    return first.offsetWidth + gap || 1;
  }
}
