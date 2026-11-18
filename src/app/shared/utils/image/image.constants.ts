/**
 * Shared image limits, supported MIME types, extensions, and managed Storage folders.
 */

export const IMAGE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.avif'],
  maxAltLength: 125,
  maxGallerySize: 8,
} as const;

export const IMAGE_FOLDERS = ['hero', 'products', 'brands', 'categories'] as const;

export type ImageFolderRoot = (typeof IMAGE_FOLDERS)[number];

/**
 * Allows root folders ('hero', 'products') or entity subfolders ('products/<productId>').
 */
export type ImageFolderPath = ImageFolderRoot | `${ImageFolderRoot}/${string}`;

export const PROTECTED_STORAGE_PATHS = ['hero/default-hero.jpg'] as const;

/** A width and height in pixels. */
export interface PhotoSize {
  readonly width: number;
  readonly height: number;
}

/**
 * One place in the store that shows a photo: the shape of its frame, the size that fits it
 * perfectly and the smallest size that still looks sharp. Admin pickers read this list (ATS-328).
 */
export interface PhotoSpot {
  /** Frame shape, width part (4 in 4:5). */
  readonly ratioWidth: number;
  /** Frame shape, height part (5 in 4:5). */
  readonly ratioHeight: number;
  readonly best: PhotoSize;
  readonly smallest: PhotoSize;
  /** What the frame is called in hints: "the card", "the banner", "the frame". */
  readonly frameName: string;
  /** Tailwind aspect class for the admin preview, matching the store frame. */
  readonly aspectClass: string;
}

/**
 * Frames on the store (product-card.css, product-page.css, home-product-rows.css, navigation.css,
 * hero-section, shop-categories-section). Change a number here and every picker follows.
 */
export const PHOTO_SPOTS = {
  product: {
    ratioWidth: 4,
    ratioHeight: 5,
    best: { width: 1600, height: 2000 },
    smallest: { width: 1200, height: 1500 },
    frameName: 'card',
    aspectClass: 'aspect-4/5',
  },
  homeCategoryCard: {
    ratioWidth: 4,
    ratioHeight: 5,
    best: { width: 1600, height: 2000 },
    smallest: { width: 1200, height: 1500 },
    frameName: 'card',
    aspectClass: 'aspect-4/5',
  },
  homeNavList: {
    ratioWidth: 4,
    ratioHeight: 5,
    best: { width: 1600, height: 2000 },
    smallest: { width: 1200, height: 1500 },
    frameName: 'frame',
    aspectClass: 'aspect-4/5',
  },
  heroBanner: {
    ratioWidth: 16,
    ratioHeight: 9,
    best: { width: 2400, height: 1350 },
    smallest: { width: 1920, height: 1080 },
    frameName: 'banner',
    aspectClass: 'aspect-video',
  },
  categoryPhoto: {
    ratioWidth: 1,
    ratioHeight: 1,
    best: { width: 1200, height: 1200 },
    smallest: { width: 800, height: 800 },
    frameName: 'frame',
    aspectClass: 'aspect-square',
  },
  brandLogo: {
    ratioWidth: 1,
    ratioHeight: 1,
    best: { width: 1200, height: 1200 },
    smallest: { width: 800, height: 800 },
    frameName: 'frame',
    aspectClass: 'aspect-square',
  },
} as const satisfies Record<string, PhotoSpot>;

export type PhotoSpotId = keyof typeof PHOTO_SPOTS;

/** Shape differences up to this share (3%) count as a fit. */
export const PHOTO_FIT_TOLERANCE = 0.03;
