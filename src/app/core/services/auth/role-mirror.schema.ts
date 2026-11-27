import * as v from 'valibot';
import { readExtras } from './staff-extras';

/** `roles/{uid}` mirror written by the Admin SDK. The claim stays the source of truth. */
export const RoleMirrorSchema = v.object({
  role: v.picklist(['admin', 'staff', 'user']),
  email: v.optional(v.string(), ''),
  // Staff only: extra access switched on in Settings → Team (ATS-368). The claim decides.
  extras: v.optional(
    v.pipe(
      v.array(v.string()),
      v.transform((list) => readExtras(list)),
    ),
    [],
  ),
});

export type RoleMirror = v.InferOutput<typeof RoleMirrorSchema>;

export function parseRoleMirror(data: unknown): RoleMirror | null {
  const parsed = v.safeParse(RoleMirrorSchema, data);
  return parsed.success ? parsed.output : null;
}
