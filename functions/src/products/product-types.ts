import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { PRODUCT_TYPES } from './catalog-mapping.js';

/**
 * Product types staff manage in Categories & Brands → Types (ATS-388): one ordered list in
 * `settings/productTypes` (`{ types: [{ id, label, phrase, categoryId }] }`). With no saved list
 * the 10 built-in types are the list. Keep in sync with
 * src/app/core/services/products/product-types.ts.
 */
export const PRODUCT_TYPES_DOC_PATH = 'settings/productTypes';

export const MAX_TYPE_ID = 40;
const MAX_PRODUCT_TYPES = 60;
const TYPE_ID_CHARS = /^[a-z0-9-]+$/;

const BUILT_IN_TYPE_IDS: readonly string[] = PRODUCT_TYPES.map((type) => type.id);

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

/** The type ids staff can pick now: the saved list's, or the built-ins when none is saved. */
export function knownTypeIds(data: DocumentData | undefined): ReadonlySet<string> {
  const raw = data?.['types'];
  if (!Array.isArray(raw) || raw.length === 0) return new Set(BUILT_IN_TYPE_IDS);
  const ids = raw
    .slice(0, MAX_PRODUCT_TYPES)
    .map((entry: unknown) =>
      entry && typeof entry === 'object' ? (entry as Record<string, unknown>)['id'] : undefined,
    )
    .filter(isTypeId);
  return ids.length > 0 ? new Set(ids) : new Set(BUILT_IN_TYPE_IDS);
}

/**
 * The chosen type must be in Types, unless the product already had it (a type removed from the
 * list stays on the products that use it, so they can still be saved).
 */
export async function assertKnownType(
  tx: Transaction,
  db: Firestore,
  type: string,
  liveTypes: readonly unknown[] = [],
): Promise<void> {
  if (liveTypes.includes(type)) return;
  const snap = await tx.get(db.doc(PRODUCT_TYPES_DOC_PATH));
  if (!knownTypeIds(snap.data()).has(type)) {
    throw new HttpsError('failed-precondition', 'That type was removed. Reload the page and pick another.');
  }
}

/** "hoodies" → "Hoodies": the search label for a type that has no built-in name. */
export function readableTypeId(id: string): string {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
