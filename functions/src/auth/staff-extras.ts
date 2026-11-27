/**
 * Extra access an admin can switch on for one staff member (ATS-368), stored in the Auth custom
 * claim `extras` next to `role`. Admins always have all of them; normal accounts never do.
 * Keep in step with `src/app/core/services/auth/staff-extras.ts` and `hasExtra()` in firestore.rules.
 */
export const STAFF_EXTRAS = ['refunds', 'deleteOrders', 'money'] as const;

export type StaffExtra = (typeof STAFF_EXTRAS)[number];

export function isStaffExtra(value: unknown): value is StaffExtra {
  return typeof value === 'string' && (STAFF_EXTRAS as readonly string[]).includes(value);
}

/** The known extras in a claim or request value, once each, in `STAFF_EXTRAS` order. Anything else is dropped. */
export function readExtras(value: unknown): StaffExtra[] {
  if (!Array.isArray(value)) return [];
  return STAFF_EXTRAS.filter((extra) => value.includes(extra));
}

/** Admins have every extra; staff only the ones switched on for them. */
export function roleHasExtra(
  role: 'user' | 'staff' | 'admin',
  extras: readonly StaffExtra[],
  extra: StaffExtra,
): boolean {
  return role === 'admin' || (role === 'staff' && extras.includes(extra));
}

/** At least one extra the person had is switched off, so their current sign-in has to end. */
export function removesExtra(before: readonly StaffExtra[], after: readonly StaffExtra[]): boolean {
  return before.some((extra) => !after.includes(extra));
}
