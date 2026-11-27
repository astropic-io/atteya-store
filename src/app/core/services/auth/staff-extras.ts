/**
 * Extra access an admin can switch on for one staff member in Settings → Team (ATS-368). The Auth
 * claim `extras` holds them; the server checks it (`requireExtra()` in functions, `hasExtra()` in
 * firestore.rules). Keep in step with `functions/src/auth/staff-extras.ts`.
 */
export const STAFF_EXTRAS = ['refunds', 'deleteOrders', 'money'] as const;

export type StaffExtra = (typeof STAFF_EXTRAS)[number];

/** The known extras in a claim or mirror value, once each. Anything else is dropped. */
export function readExtras(value: unknown): StaffExtra[] {
  if (!Array.isArray(value)) return [];
  return STAFF_EXTRAS.filter((extra) => value.includes(extra));
}

export function sameExtras(left: readonly StaffExtra[], right: readonly StaffExtra[]): boolean {
  return left.length === right.length && left.every((extra) => right.includes(extra));
}
