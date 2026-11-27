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

/** True when `count` items are wider than the row, so looping makes sense. */
export function endlessRowFits(el: HTMLElement, count: number): boolean {
  return count > 1 && endlessCopyWidth(el, count) > el.clientWidth + 2;
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

/** Put the row on the same item in copy 1 (no animation). */
export function endlessRecentre(el: HTMLElement, count: number): void {
  const width = endlessCopyWidth(el, count);
  if (width <= 0) return;
  const left = el.scrollLeft;
  if (left < width - 1) jumpTo(el, left + width);
  else if (left >= 2 * width - 1) jumpTo(el, left - width);
}

/**
 * Start a three-copy row on copy 1 and keep it there: whenever the row comes to rest (no
 * scroll events for 120 ms and no finger or mouse button down) in copy 0 or copy 2, it jumps
 * to the same item in copy 1. Returns the clean-up function.
 */
export function attachEndlessRow(el: HTMLElement, count: () => number): () => void {
  endlessRecentre(el, count());

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pressed = false;
  const settle = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!pressed) endlessRecentre(el, count());
    }, REST_MS);
  };
  const press = (): void => {
    pressed = true;
  };
  const release = (): void => {
    pressed = false;
    settle();
  };

  el.addEventListener('scroll', settle, { passive: true });
  el.addEventListener('touchstart', press, { passive: true });
  el.addEventListener('touchend', release, { passive: true });
  el.addEventListener('touchcancel', release, { passive: true });
  el.addEventListener('pointerdown', press, { passive: true });
  window.addEventListener('pointerup', release, { passive: true });
  window.addEventListener('pointercancel', release, { passive: true });

  return () => {
    if (timer) clearTimeout(timer);
    el.removeEventListener('scroll', settle);
    el.removeEventListener('touchstart', press);
    el.removeEventListener('touchend', release);
    el.removeEventListener('touchcancel', release);
    el.removeEventListener('pointerdown', press);
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
  };
}
