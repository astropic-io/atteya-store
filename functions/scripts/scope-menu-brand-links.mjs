/**
 * Makes the brand links inside a category's menu open that category only (Racket › Nox opened
 * every Nox product). Each link in the Rackets and Apparel menus that points at a brand page
 * (`/brand/nox`) becomes Shop with Filters for that brand and category
 * (`/shop?category=rackets&brand=Nox`). A brand with no shown products in that category is
 * removed from the column. A column that fills itself with brands is switched to its own links,
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

/** Shown products per brand id in one category. */
async function brandCounts(categoryId) {
  const snap = await db
    .collection('products')
    .where('categoryIds', 'array-contains', categoryId)
    .where('published', '==', true)
    .limit(2000)
    .get();
  const counts = new Map();
  for (const doc of snap.docs) {
    const brandId = doc.get('brandId');
    if (typeof brandId === 'string') counts.set(brandId, (counts.get(brandId) ?? 0) + 1);
  }
  return counts;
}

/** The brand id a link opens as a brand page, or null. */
function brandIdOf(link) {
  if (link?.target?.kind === 'brand') return link.target.id;
  const slug = /^\/brand\/([a-z0-9-]+)$/i.exec(String(link?.path ?? '').trim())?.[1];
  if (!slug) return null;
  const brand = [...brands.values()].find((item) => item.slug === slug.toLowerCase() || item.id === slug);
  return brand?.id ?? null;
}

function menuCategoryId(menu) {
  if (menu?.target?.kind === 'category') return menu.target.id;
  return /^\/category\/([a-z0-9-]+)$/i.exec(String(menu?.path ?? '').trim())?.[1] ?? null;
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
  const megaMenu = menu.megaMenu.map((column) => {
    const links = column.links ?? [];
    if (!links.some((link) => brandIdOf(link))) return column;
    const next = { ...column };
    if (next.auto?.kind === 'brands' || next.auto?.kind === 'newest-brands') {
      delete next.auto;
      changes++;
      report.push(`${menu.label} › ${column.title}: stops filling itself with brands`);
    }
    next.links = links.flatMap((link) => {
      const brandId = brandIdOf(link);
      if (!brandId) return [link];
      const brand = brands.get(brandId);
      const count = counts.get(brandId) ?? 0;
      changes++;
      if (!brand || count === 0) {
        report.push(
          `${menu.label} › ${column.title}: REMOVE ${link.label} (no ${shopCategory} on the store)`,
        );
        return [];
      }
      const path = `/shop?${new URLSearchParams({ category: shopCategory, brand: brand.name }).toString()}`;
      report.push(
        `${menu.label} › ${column.title}: ${link.label}  ${link.path}  →  ${path}  (${count} items)`,
      );
      const { isBrand: _isBrand, ...rest } = link;
      return [
        { ...rest, path, target: { kind: 'shop', filters: { brand: brandId, category: shopCategory } } },
      ];
    });
    return next;
  });
  categories.push({ ...menu, megaMenu });
}

console.log(`Project: ${projectId}${dryRun ? ' (dry run)' : ''}`);
console.log(report.length ? report.join('\n') : 'Nothing to change.');

if (dryRun || changes === 0) process.exit(0);

const backup = join(tmpdir(), `navigation-backup-${projectId}-${Date.now()}.json`);
writeFileSync(backup, JSON.stringify(nav, null, 2));
console.log(`Backup saved: ${backup}`);

await navRef.update({ categories, updatedAt: FieldValue.serverTimestamp() });
console.log(`Saved ${changes} change(s).`);
