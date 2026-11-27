/**
 * Endless scroll row (home New Arrivals and Padel rows, product page photos).
 *
 * The row's items are rendered three times in a row: copy 0, copy 1 (the one the shopper
 * starts on) and copy 2. Swiping, dragging or the arrows simply keep going into the next or
 * previous copy, so after the last item the first one comes next, and before the first the
 * last. Once the row comes to rest inside copy 0 or copy 2 it jumps by one copy's width with
 * no animation, landing on the same item in copy 1, so the shopper never reaches an end.
 *
 * Only loop a row whose items don't all fit (`endlessRowFits`); otherwise the copies would
 * show side by side.
 */

/** Quiet time with no scroll events before the row is treated as at rest. */
const REST_MS = 120;

/** Width of one item plus the gap after it (or the row width when it has no items). */
export function endlessStride(el: HTMLElement): number {
  const first = el.children[0] as HTMLElement | undefined;
  const second = el.children[1] as HTMLElement | undefined;
  if (!first) return el.clientWidth || 1;
  if (second) {
    const stride = second.getBoundingClientRect().left - first.getBoundingClientRect().left;
    if (stride > 0) return stride;
  }
  return first.offsetWidth || el.clientWidth || 1;
}

/** Width of one full copy of the items. */
export function endlessCopyWidth(el: HTMLElement, count: number): number {
  return endlessStride(el) * count;
}

/** Width the `count` items take up side by side (no gap after the last one). */
export function endlessSpan(el: HTMLElement, count: number): number {
  const first = el.children[0] as HTMLElement | undefined;
  if (!first || count <= 0) return 0;
  return (count - 1) * endlessStride(el) + first.offsetWidth;
}

/** True when `count` items are wider than the row, so looping makes sense. */
export function endlessRowFits(el: HTMLElement, count: number): boolean {
  return count > 1 && endlessSpan(el, count) > el.clientWidth + 2;
}

/** Index (0 to count - 1) of the item at the row's start, whatever copy it is in. */
export function endlessIndex(el: HTMLElement, count: number): number {
  if (count <= 0) return 0;
  const index = Math.round(el.scrollLeft / endlessStride(el));
  return ((index % count) + count) % count;
}

/** Progress for the thin line under a looping row: 0 on the first item, 1 on the last. */
export function endlessProgress(el: HTMLElement, count: number): number {
  return count > 1 ? endlessIndex(el, count) / (count - 1) : 1;
}

/** Move the row without snapping or smooth scrolling getting in the way. */
function jumpTo(el: HTMLElement, left: number): void {
  const snap = el.style.scrollSnapType;
  const behavior = el.style.scrollBehavior;
  el.style.scrollSnapType = 'none';
  el.style.scrollBehavior = 'auto';
  el.scrollLeft = left;
  // Read once so the jump is applied before snapping comes back.
  void el.scrollLeft;
  el.style.scrollSnapType = snap;
  el.style.scrollBehavior = behavior;
}

/** Scroll the row by one item (endless: there is always one more either way). */
export function endlessStep(el: HTMLElement, count: number, direction: 1 | -1): void {
  // Back to copy 1 first, so quick presses during a smooth scroll never walk to a real end.
  endlessRecentre(el, count);
  const stride = endlessStride(el);
  el.scrollTo({ left: (Math.round(el.scrollLeft / stride) + direction) * stride });
}

/** Leaving the loop: once copies 0 and 2 are gone, show the item that was at the start. */
export function endlessCollapseTo(el: HTMLElement, index: number): void {
  jumpTo(el, index * endlessStride(el));
}

/** Put the row on the same item in copy 1 (no animation). */
export function endlessRecentre(el: HTMLElement, count: number): void {
  const width = endlessCopyWidth(el, count);
  if (width <= 0) return;
  const left = el.scrollLeft;
  if (left < width - 1) jumpTo(el, left + width);
  else if (left >= 2 * width - 1) jumpTo(el, left - width);
}

/**
 * Keep a three-copy row on copy 1: whenever the row comes to rest (no scroll events for
 * 120 ms, no finger on it and no mouse button down) in copy 0 or copy 2, it jumps to the same
 * item in copy 1. Call `endlessRecentre` as soon as the copies are inserted (a
 * MutationObserver callback runs before the browser paints) so copy 0 never shows. Returns the
 * clean-up function.
 */
export function attachEndlessRow(el: HTMLElement, count: () => number): () => void {
  endlessRecentre(el, count());

  let timer: ReturnType<typeof setTimeout> | null = null;
  // Touch is tracked with touch events only: a touch's pointercancel fires as soon as the
  // browser starts panning, while the finger is still down.
  let touches = 0;
  let mouseDown = false;
  const settle = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (touches === 0 && !mouseDown) endlessRecentre(el, count());
    }, REST_MS);
  };
  const onTouch = (event: TouchEvent): void => {
    touches = event.touches.length;
    if (touches === 0) settle();
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') mouseDown = true;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || !mouseDown) return;
    mouseDown = false;
    settle();
  };

  el.addEventListener('scroll', settle, { passive: true });
  el.addEventListener('touchstart', onTouch, { passive: true });
  el.addEventListener('touchend', onTouch, { passive: true });
  el.addEventListener('touchcancel', onTouch, { passive: true });
  el.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });

  return () => {
    if (timer) clearTimeout(timer);
    el.removeEventListener('scroll', settle);
    el.removeEventListener('touchstart', onTouch);
    el.removeEventListener('touchend', onTouch);
    el.removeEventListener('touchcancel', onTouch);
    el.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };
}
