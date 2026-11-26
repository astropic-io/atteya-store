/**
 * The offer product picker (ATS-270): one row per product (all colours of one model together),
 * then a Colours choice. "All colours" is saved as the product's model (`modelGroup`), so a colour
 * added later joins the offer; specific colours are saved as those colours' product ids. Pure, so
 * `npm run test:cart` covers it.
 */

/** The product fields the picker reads. */
export interface PickerProduct {
  readonly id: string;
  readonly name: string;
  readonly modelGroup?: string | null;
  readonly colors?: readonly string[];
  readonly published?: boolean;
  readonly brandId?: string | null;
  readonly categoryId?: string | null;
  readonly categoryIds?: readonly string[];
}

/** Brand and category names for the picker's search text and second line (ATS-331). */
export interface PickerCatalog {
  readonly brandName: (brandId: string) => string | null;
  /** The name of a category, and whether it is a sub-category (the most specific one wins). */
  readonly category: (categoryId: string) => { readonly name: string; readonly depth: number } | null;
}

/** A colour's name and dot, from the colour palette. */
export interface PickerColourInfo {
  readonly label: string;
  readonly swatch: string | null;
}

export interface OfferProductColour {
  readonly productId: string;
  readonly colorId: string | null;
  readonly label: string;
  readonly swatch: string | null;
  /** Hidden from the store (not published). */
  readonly hidden: boolean;
}

/** One product as staff see it: every colour of one model, or one product without a model. */
export interface OfferProductModel {
  readonly key: string;
  readonly modelGroup: string | null;
  readonly name: string;
  readonly colours: readonly OfferProductColour[];
  /** Every word staff can search by, already simplified: each colour's own name, brand and categories. */
  readonly searchText: string;
  /** The colours' own names when they differ from `name` ("Siux Socks" under "Siux Ball Edition Socks"). */
  readonly otherNames: readonly string[];
  /** "Siux · Socks · 2 colours: Black, White": brand, most specific category, colours. */
  readonly detail: string;
}

/** One picked product: all its colours, or the colours ticked. */
export interface ProductPick {
  readonly key: string;
  /** Null when the product no longer exists. */
  readonly model: OfferProductModel | null;
  readonly all: boolean;
  readonly productIds: readonly string[];
}

/** What a product rule saves: models picked with All colours, and single product ids. */
export interface SavedProductPicks {
  readonly modelGroups: readonly string[];
  readonly productIds: readonly string[];
}

/** Lower case with accents removed, so "Agustín" and "agustin" match. */
export function simplifySearchText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The typed words, simplified (empty for a blank query). */
export function searchQueryWords(query: string): string[] {
  return simplifySearchText(query)
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/** True when every typed word is found in the text. The text is already simplified. */
export function matchesAllWords(searchText: string, words: readonly string[]): boolean {
  return words.every((word) => searchText.includes(word));
}

/** True when the name contains the whole typed text, in the typed order. */
export function nameHasWholeQuery(name: string, words: readonly string[]): boolean {
  return simplifySearchText(name).includes(words.join(' '));
}

/** The colour's own name that matches the typed words and differs from the product's name, or null. */
export function matchedOtherName(model: OfferProductModel, words: readonly string[]): string | null {
  if (words.length === 0) return null;
  return model.otherNames.find((name) => matchesAllWords(simplifySearchText(name), words)) ?? null;
}

/** Groups the products into one entry per model (first colour's name), in the order they come. */
export function groupOfferProducts(
  products: readonly PickerProduct[],
  colourInfo: (colorId: string) => PickerColourInfo | null,
  catalog?: PickerCatalog,
): OfferProductModel[] {
  const buckets = new Map<string, { modelGroup: string | null; items: PickerProduct[] }>();
  for (const product of products) {
    // Kept exactly as saved: offers match the product's own value.
    const modelGroup = product.modelGroup || null;
    const key = modelGroup ? `model:${modelGroup}` : `product:${product.id}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.items.push(product);
    else buckets.set(key, { modelGroup, items: [product] });
  }
  return [...buckets].map(([key, bucket]) => {
    const name = bucket.items[0]!.name;
    const colours = colourRows(bucket.items, colourInfo);
    const otherNames = [...new Set(bucket.items.map((item) => item.name))].filter((other) => other !== name);
    const brand = bucket.items
      .map((item) => (item.brandId && catalog?.brandName(item.brandId)) || null)
      .find(Boolean);
    const category = mostSpecificCategory(bucket.items[0]!, catalog);
    const categoryNames = new Set<string>();
    for (const item of bucket.items) {
      for (const id of [item.categoryId, ...(item.categoryIds ?? [])]) {
        const found = id ? catalog?.category(id) : null;
        if (found) categoryNames.add(found.name);
      }
    }
    return {
      key,
      modelGroup: bucket.modelGroup,
      name,
      colours,
      otherNames,
      searchText: simplifySearchText(
        [
          ...bucket.items.map((item) => item.name),
          brand ?? '',
          ...categoryNames,
          bucket.modelGroup ?? '',
        ].join(' '),
      ),
      detail: modelDetail(brand ?? null, category, colours),
    };
  });
}

/** The product's deepest category name (a sub-category beats its parent). */
function mostSpecificCategory(product: PickerProduct, catalog?: PickerCatalog): string | null {
  if (!catalog) return null;
  let best: { name: string; depth: number } | null = null;
  for (const id of [product.categoryId, ...(product.categoryIds ?? [])]) {
    const found = id ? catalog.category(id) : null;
    if (found && (!best || found.depth > best.depth)) best = found;
  }
  return best?.name ?? null;
}

/** "Siux · Socks · 2 colours: Black, White" or "Siux · Socks · Black"; a missing part is left out. */
function modelDetail(
  brand: string | null,
  category: string | null,
  colours: readonly OfferProductColour[],
): string {
  // A colour with no colour set has only a placeholder name ("Colour 1"): not worth showing.
  const named = colours.filter((colour) => colour.colorId !== null);
  const labels = named.map((colour) => colour.label).join(', ');
  const colourPart = named.length >= 2 ? `${named.length} colours: ${labels}` : labels;
  return [brand, category, colourPart].filter((part) => part).join(' · ');
}

/**
 * Each colour's name: its main colour, or every colour it has ("Black & Red") when two colours of
 * the product share the main colour (look-alikes told apart by an accent colour).
 */
function colourRows(
  items: readonly PickerProduct[],
  colourInfo: (colorId: string) => PickerColourInfo | null,
): OfferProductColour[] {
  const labelOf = (colorId: string): string => colourInfo(colorId)?.label ?? colorId;
  const firstLabels = items.map((product) => (product.colors?.[0] ? labelOf(product.colors[0]) : null));
  return items.map((product, index) => {
    const colorId = product.colors?.[0] ?? null;
    const first = firstLabels[index];
    const shared = first !== null && firstLabels.filter((label) => label === first).length > 1;
    const label =
      first === null
        ? `Colour ${index + 1}`
        : shared && (product.colors?.length ?? 0) > 1
          ? product.colors!.map(labelOf).join(' & ')
          : first;
    return {
      productId: product.id,
      colorId,
      label,
      swatch: colorId ? (colourInfo(colorId)?.swatch ?? null) : null,
      hidden: product.published === false,
    };
  });
}

/** The colours All colours saves when it can only name products: the shown ones, or all when none is shown. */
function expandedColours(model: OfferProductModel): readonly OfferProductColour[] {
  const shown = model.colours.filter((colour) => !colour.hidden);
  return shown.length > 0 ? shown : model.colours;
}

/** True when the product has 2 or more colours, so staff pick All colours or some of them. */
export function hasColourChoice(model: OfferProductModel | null): boolean {
  return (model?.colours.length ?? 0) >= 2;
}

/**
 * Reads saved models and product ids back as picks. Product ids of one model are grouped as that
 * product with those colours ticked (an offer saved before ATS-270 opens this way). With
 * `expandModels`, a product whose every colour is picked reads as All colours.
 */
export function readProductPicks(
  saved: SavedProductPicks,
  models: readonly OfferProductModel[],
  expandModels = false,
): ProductPick[] {
  const byGroup = new Map<string, OfferProductModel>();
  const byProduct = new Map<string, OfferProductModel>();
  for (const model of models) {
    if (model.modelGroup) byGroup.set(model.modelGroup, model);
    for (const colour of model.colours) byProduct.set(colour.productId, model);
  }
  const picks = new Map<string, { model: OfferProductModel | null; all: boolean; productIds: string[] }>();
  for (const modelGroup of saved.modelGroups) {
    const model = byGroup.get(modelGroup) ?? null;
    const key = model?.key ?? `model:${modelGroup}`;
    if (!picks.has(key)) picks.set(key, { model, all: true, productIds: [] });
  }
  for (const productId of saved.productIds) {
    const model = byProduct.get(productId) ?? null;
    const grouped = model !== null && hasColourChoice(model);
    const key = grouped ? model.key : `product:${productId}`;
    const pick = picks.get(key);
    if (!pick) {
      picks.set(key, { model, all: false, productIds: [productId] });
    } else if (!pick.all && !pick.productIds.includes(productId)) {
      pick.productIds.push(productId);
    }
  }
  return [...picks].map(([key, pick]) => {
    const everyColour =
      expandModels &&
      !pick.all &&
      hasColourChoice(pick.model) &&
      expandedColours(pick.model!).every((colour) => pick.productIds.includes(colour.productId));
    if (everyColour) return { key, model: pick.model, all: true, productIds: [] };
    if (pick.all) return { key, model: pick.model, all: true, productIds: [] };
    // Keep the colours in the product's own order.
    const order = pick.model?.colours.map((colour) => colour.productId) ?? [];
    const productIds = [...pick.productIds].sort((a, b) => rank(order, a) - rank(order, b));
    return { key, model: pick.model, all: false, productIds };
  });
}

function rank(order: readonly string[], id: string): number {
  const at = order.indexOf(id);
  return at === -1 ? order.length : at;
}

/**
 * The saved form of the picks. All colours saves the model, unless `expandModels` (free gifts and
 * the Buy X Get Y free item, which name products): then it saves every colour shown on the store
 * today (hidden colours are left out, unless every colour is hidden).
 */
export function writeProductPicks(picks: readonly ProductPick[], expandModels = false): SavedProductPicks {
  const modelGroups: string[] = [];
  const productIds: string[] = [];
  const addProduct = (id: string): void => {
    if (!productIds.includes(id)) productIds.push(id);
  };
  for (const pick of picks) {
    if (pick.all) {
      const modelGroup = pick.model?.modelGroup ?? (pick.key.startsWith('model:') ? pick.key.slice(6) : null);
      if (expandModels && pick.model) {
        expandedColours(pick.model).forEach((colour) => addProduct(colour.productId));
      } else if (modelGroup && !modelGroups.includes(modelGroup)) {
        modelGroups.push(modelGroup);
      }
    } else {
      pick.productIds.forEach(addProduct);
    }
  }
  return { modelGroups, productIds };
}

/** A new pick for a product: All colours when it has several, otherwise that one product. */
export function newProductPick(model: OfferProductModel): ProductPick {
  if (hasColourChoice(model) && model.modelGroup) {
    return { key: model.key, model, all: true, productIds: [] };
  }
  return {
    key: hasColourChoice(model) ? model.key : `product:${model.colours[0]!.productId}`,
    model,
    all: false,
    productIds: model.colours.map((colour) => colour.productId),
  };
}

/** The value for the All colours option of the Colours dropdown. */
export const ALL_COLOURS = 'all';

/**
 * The Colours dropdown's new choice. Ticking All colours clears the specific ones, ticking a
 * colour unticks All colours, and unticking every colour goes back to All colours.
 */
export function nextColourChoice(pick: ProductPick, selected: readonly string[]): ProductPick {
  const specific = selected.filter((value) => value !== ALL_COLOURS);
  const allTicked = selected.includes(ALL_COLOURS);
  if (specific.length === 0 || (allTicked && !pick.all)) {
    return { ...pick, all: true, productIds: [] };
  }
  const order = pick.model?.colours.map((colour) => colour.productId) ?? [];
  return { ...pick, all: false, productIds: [...specific].sort((a, b) => rank(order, a) - rank(order, b)) };
}

/** The dropdown's selected values for a pick. */
export function colourChoiceValues(pick: ProductPick): readonly string[] {
  return pick.all ? [ALL_COLOURS] : pick.productIds;
}

/** "Nox Padel Shorts · All colours", "Nox Padel Shorts · Black, White", or the name alone. */
export function productPickLabel(pick: ProductPick): string {
  if (!pick.model) return 'Product not found';
  if (!hasColourChoice(pick.model)) return pick.model.name;
  if (pick.all) return `${pick.model.name} · All colours`;
  const labels = pick.productIds.map(
    (id) => pick.model!.colours.find((colour) => colour.productId === id)?.label ?? 'Colour not found',
  );
  return `${pick.model.name} · ${labels.join(', ')}`;
}

/** "3 colours" for a product with several, or null. */
export function colourCountNote(model: OfferProductModel): string | null {
  return hasColourChoice(model) ? `${model.colours.length} colours` : null;
}

/** Product name per model (the first colour's name), for tags and sentences. */
export function modelNames(products: readonly PickerProduct[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const product of products) {
    const modelGroup = product.modelGroup;
    if (modelGroup && !names.has(modelGroup)) names.set(modelGroup, product.name);
  }
  return names;
}
