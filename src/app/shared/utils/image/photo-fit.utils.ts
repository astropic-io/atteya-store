import { IMAGE_LIMITS, PHOTO_FIT_TOLERANCE, PhotoSize, PhotoSpot } from './image.constants';

/** "1600 × 2000 px". */
export function photoSizeLabel(size: PhotoSize): string {
  return `${size.width} × ${size.height} px`;
}

/** "Portrait, 4 wide by 5 tall", "Landscape, 16 wide by 9 tall" or "Square". */
export function photoShapeLabel(spot: PhotoSpot): string {
  const { ratioWidth: w, ratioHeight: h } = spot;
  if (w === h) return 'Square';
  return `${w > h ? 'Landscape' : 'Portrait'}, ${w} wide by ${h} tall`;
}

/** "JPG, PNG, WebP or AVIF, up to 10 MB". */
export const PHOTO_FILE_HINT = `JPG, PNG, WebP or AVIF, up to ${Math.round(IMAGE_LIMITS.maxBytes / (1024 * 1024))} MB`;

export interface PhotoFit {
  /** The photo's own size. */
  readonly size: PhotoSize;
  /** True when the shape is within 3% of the frame. */
  readonly fits: boolean;
  /** Which way the photo is off when it doesn't fit. */
  readonly cut: 'none' | 'sides' | 'top-bottom';
  /** Share of the photo cut from each side (or top and bottom), in whole percent. */
  readonly cutPercentEach: number;
  /**
   * Size of the frame drawn over a preview that shows the whole photo (object-contain in a
   * frame-shaped box), as a percent of the box in both directions. 100 when it fits.
   */
  readonly framePercent: number;
  /** True when the part the store shows is below the smallest sharp size. */
  readonly isSmall: boolean;
}

/**
 * Compares a photo with its store frame. The store fills the frame (object-cover), so a photo of
 * another shape loses the edges that stick out. Returns null when the size is unknown.
 */
export function checkPhotoFit(spot: PhotoSpot, width?: number, height?: number): PhotoFit | null {
  if (!width || !height || width <= 1 || height <= 1) return null;

  const frameRatio = spot.ratioWidth / spot.ratioHeight;
  const photoRatio = width / height;
  const shapeGap = photoRatio / frameRatio - 1;
  const fits = Math.abs(shapeGap) <= PHOTO_FIT_TOLERANCE;
  const wider = photoRatio > frameRatio;

  // The part of the photo the frame shows (in the photo's own pixels).
  const shownWidth = wider ? height * frameRatio : width;
  const shown = Math.min(frameRatio / photoRatio, photoRatio / frameRatio);
  const isSmall = shownWidth + 0.5 < spot.smallest.width;

  return {
    size: { width, height },
    fits,
    cut: fits ? 'none' : wider ? 'sides' : 'top-bottom',
    cutPercentEach: fits ? 0 : Math.max(1, Math.round(((1 - shown) / 2) * 100)),
    framePercent: fits ? 100 : shown * 100,
    isSmall,
  };
}

/** The warning or note under a photo, in plain words. */
export function photoFitMessage(spot: PhotoSpot, fit: PhotoFit): string {
  const best = photoSizeLabel(spot.best);
  if (fit.cut === 'sides') {
    return `This photo is wider than the ${spot.frameName}, so about ${fit.cutPercentEach}% is cut from each side. For a perfect fit use ${best}.`;
  }
  if (fit.cut === 'top-bottom') {
    return `This photo is taller than the ${spot.frameName}, so about ${fit.cutPercentEach}% is cut from the top and bottom. For a perfect fit use ${best}.`;
  }
  return `Fits the ${spot.frameName}`;
}

/** "This photo is small and may look blurry. Use at least 1200 × 1500 px." */
export function photoSmallMessage(spot: PhotoSpot): string {
  return `This photo is small and may look blurry. Use at least ${photoSizeLabel(spot.smallest)}.`;
}

/** Hero banner shapes: the computer preview is 16:9 and a phone shows a 9:16 slice. */
const HERO_COMPUTER_RATIO = 16 / 9;
const HERO_PHONE_RATIO = 9 / 16;

/**
 * Where a phone's slice of the hero photo sits on the 16:9 computer preview, as a percent of that
 * preview in each direction. A phone fills its full-height frame with the whole photo
 * (object-cover), so the slice depends on the photo's own shape. `showsWholePhoto` is true when the
 * preview shows the whole photo (object-contain, a photo that doesn't fit 16:9); otherwise the
 * preview is filled like the store's computer banner. Unknown size: the slice of a 16:9 photo.
 */
export function heroPhoneAreaPercent(
  size: PhotoSize | null | undefined,
  showsWholePhoto: boolean,
): { readonly width: number; readonly height: number } {
  const ratio =
    showsWholePhoto && size && size.width > 0 && size.height > 0
      ? size.width / size.height
      : HERO_COMPUTER_RATIO;
  // The photo's box on the preview (object-contain), as a share of the preview.
  const photoWidth = ratio <= HERO_COMPUTER_RATIO ? ratio / HERO_COMPUTER_RATIO : 1;
  const photoHeight = ratio <= HERO_COMPUTER_RATIO ? 1 : HERO_COMPUTER_RATIO / ratio;
  // The phone keeps the full height of a wide photo, or the full width of a very tall one.
  const width = photoWidth * (ratio >= HERO_PHONE_RATIO ? HERO_PHONE_RATIO / ratio : 1);
  const height = photoHeight * (ratio >= HERO_PHONE_RATIO ? 1 : ratio / HERO_PHONE_RATIO);
  return { width: width * 100, height: height * 100 };
}
