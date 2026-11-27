/**
 * Makes the brand links inside a category's menu open that category only (Racket › Nox opened
 * every Nox product). Each link in the Rackets and Apparel menus that points at a brand page
 * (`/brand/nox`), or that names a brand but opens the menu's own category, becomes Shop with Filters for that brand and category
 * (`/shop?category=rackets&brand=Nox`). A brand with no shown products in that category is
 * removed from the column, and a column left with no links is removed. A column that fills itself
 * with brands gets fixed links for the brands it shows now (with products in that category),
 * because a filled column always opens the brand pages.
 *
 * Run from the functions directory with Application Default Credentials:
 *
 *   node scripts/scope-menu-brand-links.mjs --project atteya-store-dev           (dry run)
 *   node scripts/scope-menu-brand-links.mjs --project atteya-store-dev --apply   (writes)
 *
 * Prod needs --confirm-prod as well. Before writing it saves the current menu to
 * `navigation-backup-<project>-<time>.json` in the system temp folder (outside the repo); the store also keeps the replaced
 * menu under Admin → Navigation → Previous Versions. Safe to run again (it skips links already
 * changed).
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const next = args[index + 1];
  return next && !next.startsWith('--') ? next : true;
}

const projectId = arg('project');
const dryRun = arg('apply') !== true;
const confirmProd = arg('confirm-prod') === true;

if (!['atteya-store-dev', 'attiya-store'].includes(projectId)) {
  throw new Error('--project must be atteya-store-dev or attiya-store');
}
if (projectId === 'attiya-store' && !dryRun && !confirmProd) {
  throw new Error('Writing to prod requires --confirm-prod.');
}

/** Menus whose brand links get scoped: the menu's category id → Shop's `?category=` value. */
const SCOPED_MENUS = { rackets: 'rackets', apparel: 'apparel' };

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const navRef = db.doc('settings/navigation');
const navSnap = await navRef.get();
if (!navSnap.exists) throw new Error('settings/navigation is missing.');
const nav = navSnap.data();

const brandSnap = await db.collection('brands').get();
const brands = new Map(brandSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));

/** Most products a category may hold for this script; it stops rather than miscount. */
const MAX_PRODUCTS = 5000;

/** Shown products per brand id in one category. */
async function brandCounts(categoryId) {
  const snap = await db
    .collection('products')
    .where('categoryIds', 'array-contains', categoryId)
    .where('published', '==', true)
    .limit(MAX_PRODUCTS)
    .get();
  if (snap.size >= MAX_PRODUCTS) {
    throw new Error(
      `${categoryId} has ${MAX_PRODUCTS}+ products; counts would be wrong. Nothing was changed.`,
    );
  }
  const counts = new Map();
  for (const doc of snap.docs) {
    const brandId = doc.get('brandId');
    if (typeof brandId === 'string') counts.set(brandId, (counts.get(brandId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The brand a link in this menu means, or null: a brand-page link (`/brand/nox`; the saved path
 * counts only when there is no target), or a half-edited one that names a brand but opens the
 * menu's own category ("Bullpadel" → `/category/rackets`, which shows every brand).
 */
function brandIdOf(link, menuCategory) {
  if (link?.target?.kind === 'brand') return link.target.id;
  if (link?.target?.kind === 'category' && link.target.id === menuCategory) {
    const label = String(link.label ?? '')
      .trim()
      .toLowerCase();
    const brand = [...brands.values()].find(
      (item) => String(item.name ?? '').toLowerCase() === label || item.slug === label,
    );
    return brand?.id ?? null;
  }
  if (link?.target) return null;
  const slug = /^\/brand\/([a-z0-9-]+)$/i.exec(String(link?.path ?? '').trim())?.[1];
  if (!slug) return null;
  const brand = [...brands.values()].find((item) => item.slug === slug.toLowerCase() || item.id === slug);
  return brand?.id ?? null;
}

function menuCategoryId(menu) {
  if (menu?.target?.kind === 'category') return menu.target.id;
  return /^\/category\/([a-z0-9-]+)$/i.exec(String(menu?.path ?? '').trim())?.[1] ?? null;
}

function timeMs(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

/** What an auto brand column shows now, as plain brand links (shown brands only). */
function autoBrandLinks(auto) {
  const list = [...brands.values()].filter((brand) => brand.published === true);
  if (auto.kind === 'newest-brands') {
    list.sort((a, b) => timeMs(b.createdAt) - timeMs(a.createdAt) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  } else {
    list.sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)),
    );
  }
  return { list, limit: Number(auto.limit ?? 8) || 8 };
}

function shopLink(link, brand, shopCategory) {
  const path = `/shop?${new URLSearchParams({ category: shopCategory, brand: brand.name }).toString()}`;
  const { isBrand: _isBrand, ...rest } = link;
  return { ...rest, path, target: { kind: 'shop', filters: { brand: brand.id, category: shopCategory } } };
}

const report = [];
let changes = 0;
const categories = [];
for (const menu of nav.categories ?? []) {
  const categoryId = menuCategoryId(menu);
  const shopCategory = categoryId ? SCOPED_MENUS[categoryId] : undefined;
  if (!shopCategory || !Array.isArray(menu.megaMenu)) {
    categories.push(menu);
    continue;
  }
  const counts = await brandCounts(shopCategory);
  const megaMenu = menu.megaMenu.flatMap((column) => {
    const where = `${menu.label} › ${column.title}`;
    const isAutoBrands = column.auto?.kind === 'brands' || column.auto?.kind === 'newest-brands';
    const links = column.links ?? [];
    if (!isAutoBrands && !links.some((link) => brandIdOf(link, categoryId))) return [column];
    const next = { ...column };
    if (isAutoBrands) {
      // A column that fills itself always opens brand pages: save what it shows now instead.
      const { list, limit } = autoBrandLinks(column.auto);
      delete next.auto;
      changes++;
      next.links = list
        .filter((brand) => (counts.get(brand.id) ?? 0) > 0)
        .slice(0, limit)
        .map((brand) => shopLink({ label: brand.name }, brand, shopCategory));
      report.push(`${where}: stops filling itself; now ${next.links.length} fixed links:`);
      for (const link of next.links) report.push(`    ${link.label}  →  ${link.path}`);
    } else {
      next.links = links.flatMap((link) => {
        const brandId = brandIdOf(link, categoryId);
        if (!brandId) return [link];
        const brand = brands.get(brandId);
        const count = counts.get(brandId) ?? 0;
        changes++;
        if (!brand || count === 0) {
          report.push(`${where}: REMOVE ${link.label} (no ${shopCategory} on the store)`);
          return [];
        }
        const scoped = shopLink(link, brand, shopCategory);
        report.push(`${where}: ${link.label}  ${link.path}  →  ${scoped.path}  (${count} items)`);
        return [scoped];
      });
    }
    if (next.links.length === 0) {
      report.push(`${where}: REMOVE the column (no links left)`);
      return [];
    }
    return [next];
  });
  categories.push({ ...menu, megaMenu });
}

console.log(`Project: ${projectId}${dryRun ? ' (dry run)' : ''}`);
console.log(report.length ? report.join('\n') : 'Nothing to change.');

if (dryRun || changes === 0) process.exit(0);

const backup = join(tmpdir(), `navigation-backup-${projectId}-${Date.now()}.json`);
writeFileSync(backup, JSON.stringify(nav, null, 2));
console.log(`Backup saved: ${backup}`);

// No staff member made this save, so Previous Versions must not name the last one who did.
await navRef.update({ categories, updatedAt: FieldValue.serverTimestamp(), updatedBy: FieldValue.delete() });
console.log(`Saved ${changes} change(s).`);
