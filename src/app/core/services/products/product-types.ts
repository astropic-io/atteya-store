import * as v from 'valibot';
import { DEFAULT_CATEGORY_FOR_TYPE } from './catalog-taxonomy';
import { PRODUCT_TYPES } from './product.constants';

/**
 * Product types staff manage in Categories & Brands → Types (ATS-388). Saved as one ordered list
 * in `settings/productTypes`; with no saved list the 10 built-in types below are used.
 * Keep in sync with functions/src/products/product-types.ts.
 */
export const PRODUCT_TYPES_DOC = ['settings', 'productTypes'] as const;

/** Most types a store keeps; also the server's limit. */
export const MAX_PRODUCT_TYPES = 60;
export const MAX_TYPE_LABEL = 40;
export const MAX_TYPE_PHRASE = 40;

export const MAX_TYPE_ID = 40;
const TYPE_ID_CHARS = /^[a-z0-9-]+$/;

/** A type id: lower-case letters and digits joined by single hyphens ("t-shirts", "hoodies"). */
export function isTypeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TYPE_ID &&
    TYPE_ID_CHARS.test(value) &&
    !value.startsWith('-') &&
    !value.endsWith('-') &&
    !value.includes('--')
  );
}

/** Drops hyphens at both ends without a backtracking pattern. */
function trimHyphens(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start += 1;
  while (end > start && value[end - 1] === '-') end -= 1;
  return value.slice(start, end);
}

export interface ProductTypeEntry {
  /** Never changes once saved; products and offers store it. */
  readonly id: string;
  /** "Hoodies", "T-shirts & polos". */
  readonly label: string;
  /** How the product page names one: "this hoodie", "these socks". */
  readonly phrase: string;
  /** Category id the product editor fills in when this type is picked. */
  readonly categoryId: string;
}

const BUILT_IN_PHRASES: Readonly<Record<string, string>> = {
  rackets: 'this racket',
  bags: 'this bag',
  't-shirts': 'this shirt',
  shorts: 'these shorts',
  socks: 'these socks',
  sets: 'this set',
  grips: 'this grip',
  balls: 'these balls',
  bottles: 'this bottle',
  supports: 'this support',
};

/** The 10 types the store started with; used until staff save their own list. */
export const BUILT_IN_PRODUCT_TYPES: readonly ProductTypeEntry[] = PRODUCT_TYPES.map((type) => ({
  id: type.id,
  label: type.label,
  phrase: BUILT_IN_PHRASES[type.id] ?? 'this item',
  categoryId: DEFAULT_CATEGORY_FOR_TYPE[type.id] ?? type.category,
}));

const ProductTypeEntrySchema = v.object({
  id: v.custom<string>(isTypeId),
  label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_TYPE_LABEL)),
  phrase: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_TYPE_PHRASE)),
  categoryId: v.pipe(v.string(), v.maxLength(MAX_TYPE_ID)),
});

export const ProductTypesDocSchema = v.object({
  types: v.pipe(v.array(ProductTypeEntrySchema), v.maxLength(MAX_PRODUCT_TYPES)),
});

export type ProductTypesDoc = v.InferOutput<typeof ProductTypesDocSchema>;

/** The list to show: the saved one (duplicates dropped), or the built-ins when none is saved. */
export function resolveProductTypes(raw: unknown): readonly ProductTypeEntry[] {
  const parsed = v.safeParse(ProductTypesDocSchema, raw);
  if (!parsed.success || parsed.output.types.length === 0) return BUILT_IN_PRODUCT_TYPES;
  const seen = new Set<string>();
  return parsed.output.types.filter((type) => {
    if (seen.has(type.id)) return false;
    seen.add(type.id);
    return true;
  });
}

/** "this hoodie" for a type, or "this item" for one that is no longer in the list. */
export function typePhrase(types: readonly ProductTypeEntry[], id: string): string {
  return types.find((type) => type.id === id)?.phrase ?? BUILT_IN_PHRASES[id] ?? 'this item';
}

/** The type's name, or a readable form of its id ("hoodies" → "Hoodies") when it is not listed. */
export function typeName(types: readonly ProductTypeEntry[], id: string): string {
  const found = types.find((type) => type.id === id)?.label;
  if (found) return found;
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A new type's id from its name: accents folded, `a-z 0-9` joined by `-`, `-2` when taken. */
export function newTypeId(name: string, taken: Iterable<string>): string {
  const base =
    trimHyphens(
      trimHyphens(
        name
          .normalize('NFKD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/&/g, ' and ')
          .replace(/[^a-z0-9]+/g, '-'),
      ).slice(0, MAX_TYPE_ID - 3),
    ) || 'type';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now() % 1000}`;
}

/** Suggests the page wording from a name: "Hoodies" → "this hoodie", "Socks" → "these socks". */
export function suggestTypePhrase(name: string): string {
  const first =
    name
      .split(/[&,/]| and /i)[0]
      ?.trim()
      .toLowerCase() ?? '';
  if (!first) return '';
  if (/(shorts|socks|trousers|pants|leggings|balls|sunglasses|glasses)$/.test(first)) return `these ${first}`;
  if (/(ches|shes|sses|xes)$/.test(first)) return `this ${first.slice(0, -2)}`;
  if (/[^s]s$/.test(first)) return `this ${first.slice(0, -1)}`;
  return `this ${first}`;
}
