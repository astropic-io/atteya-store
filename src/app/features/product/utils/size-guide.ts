import type { CategorySizeChart, Product } from '@core/services/products';

export type SizeUnit = 'cm' | 'in';

type SizeValues = Readonly<Record<string, string>>;

export interface SizeGuideRow {
  readonly label: string;
  /** Value per size name; a size with no value shows a dash. */
  readonly cm: SizeValues;
  readonly in: SizeValues;
}

export interface SizeGuide {
  /** Names the table for screen readers ("T-shirt size chart"). */
  readonly label: string;
  /** Columns, in size order. */
  readonly sizes: readonly string[];
  readonly rows: readonly SizeGuideRow[];
  /** True when a row is a length (shows the Centimetres / Inches switch); weight-only charts have none. */
  readonly hasLengths: boolean;
}

function bySize(values: readonly string[], sizes: readonly string[]): SizeValues {
  return Object.fromEntries(sizes.map((size, index) => [size, values[index]]));
}

/** Weight is the same in both unit views; the label says kilograms. */
function weightRow(values: readonly string[], sizes: readonly string[]): SizeGuideRow {
  const kg = bySize(values, sizes);
  return { label: 'Weight (kg)', cm: kg, in: kg };
}

/** Same names as the size buttons on our products (2XL, not XXL). */
const SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'] as const;
const HOODIE_SIZES = ['S', 'M', 'L'] as const;

/**
 * The client's two t-shirt charts ("Size Chart Shirt" and "Size by Weight"), nothing else:
 * size by body weight, then the shirt's own width and length (cm; inches are cm ÷ 2.54 to one decimal).
 * One chart for men's, women's and unisex t-shirts.
 */
const SHIRT_GUIDE: SizeGuide = {
  label: 'T-shirt',
  sizes: SHIRT_SIZES,
  hasLengths: true,
  rows: [
    weightRow(['40 – 50', '50 – 70', '70 – 80', '80 – 90', '90 – 100', '100 – 115'], SHIRT_SIZES),
    {
      label: 'Shirt Width',
      cm: bySize(['49', '52', '54', '56', '58', '60'], SHIRT_SIZES),
      in: bySize(['19.3', '20.5', '21.3', '22', '22.8', '23.6'], SHIRT_SIZES),
    },
    {
      label: 'Shirt Length',
      cm: bySize(['60', '70', '71', '72', '73', '74'], SHIRT_SIZES),
      in: bySize(['23.6', '27.6', '28', '28.3', '28.7', '29.1'], SHIRT_SIZES),
    },
  ],
};

/** The client's hoodie chart: size by body weight only. */
const HOODIE_GUIDE: SizeGuide = {
  label: 'Hoodie',
  sizes: HOODIE_SIZES,
  hasLengths: false,
  rows: [weightRow(['50 – 70', '70 – 90', '90 – 110'], HOODIE_SIZES)],
};

/**
 * The chart for the product page's Size & Fit section, or null to hide it. Only the client's own
 * charts are shown: t-shirts (weight, shirt width and length) and hoodies (weight). Shorts, sets,
 * tracksuits and anything else with sizes show just the size buttons. The category must also use
 * the clothing size chart (`categoryPageFor()`, set per category in Categories & Brands), and the
 * product must have a size choice.
 */
export function sizeGuideFor(
  product: Pick<Product, 'categoryIds' | 'options'>,
  sizeChart: CategorySizeChart,
): SizeGuide | null {
  if (sizeChart !== 'clothing') return null;
  if (!product.options.some((option) => option.key === 'size')) return null;
  if (product.categoryIds.includes('t-shirts')) return SHIRT_GUIDE;
  if (product.categoryIds.includes('hoodies')) return HOODIE_GUIDE;
  return null;
}
