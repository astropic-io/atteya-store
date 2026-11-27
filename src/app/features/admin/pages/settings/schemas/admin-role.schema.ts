import * as v from 'valibot';
import { timestampSchema } from '@shared/schemas/common.schema';
import { readExtras } from '@core/services/auth/staff-extras';

/** Extra access names, unknown ones dropped (ATS-368). */
const EXTRAS = v.pipe(
  v.array(v.string()),
  v.transform((list) => readExtras(list)),
);

const ROLE = v.picklist(['admin', 'staff', 'user']);

export const AdminRecordSchema = v.object({
  uid: v.pipe(v.string(), v.trim(), v.nonEmpty('Admin id is required')),
  email: v.pipe(v.string(), v.trim()),
  // Older functions sent admins only, without a role.
  role: v.optional(v.picklist(['admin', 'staff']), 'admin'),
  // Older functions sent no extras.
  extras: v.optional(EXTRAS, []),
  // Super Admin (ATS-372). Older functions sent none.
  owner: v.optional(v.boolean(), false),
  updatedAt: v.nullable(v.pipe(v.string(), v.trim())),
  updatedBy: v.nullable(v.pipe(v.string(), v.trim())),
});

export const ListAdminsSchema = v.array(AdminRecordSchema);

/** One `roles/{uid}` mirror on the Team list (ATS-372). Only admin and staff rows are queried. */
export const TeamMirrorSchema = v.object({
  role: v.picklist(['admin', 'staff']),
  email: v.optional(v.pipe(v.string(), v.trim()), ''),
  extras: v.optional(EXTRAS, []),
  owner: v.optional(v.boolean(), false),
  updatedAt: v.optional(v.nullable(timestampSchema), null),
  updatedBy: v.optional(v.nullable(v.pipe(v.string(), v.trim())), null),
});

export const SetUserRoleResultSchema = v.object({
  changed: v.boolean(),
});

export const SetStaffExtrasResultSchema = SetUserRoleResultSchema;

const auditBase = {
  id: v.pipe(v.string(), v.trim(), v.nonEmpty('Activity id is required')),
  actorUid: v.optional(v.nullable(v.string()), null),
  actorEmail: v.optional(v.pipe(v.string(), v.trim()), ''),
  at: timestampSchema,
};

/** `auditLogs` rows the Team page shows: role and extra access changes, deleted orders and deleted products. */
export const RoleAuditSchema = v.variant('action', [
  v.object({
    ...auditBase,
    action: v.literal('role.set'),
    targetUid: v.pipe(v.string(), v.trim()),
    targetEmail: v.pipe(v.string(), v.trim()),
    from: ROLE,
    to: ROLE,
  }),
  v.object({
    ...auditBase,
    action: v.literal('extras.set'),
    targetEmail: v.pipe(v.string(), v.trim()),
    from: EXTRAS,
    to: EXTRAS,
  }),
  v.object({
    ...auditBase,
    action: v.literal('owner.set'),
    targetEmail: v.pipe(v.string(), v.trim()),
    to: v.boolean(),
  }),
  v.object({
    ...auditBase,
    action: v.literal('order.delete'),
    orderId: v.pipe(v.string(), v.trim()),
  }),
  v.object({
    ...auditBase,
    action: v.literal('product.delete'),
    name: v.optional(v.nullable(v.string()), null),
    productId: v.pipe(v.string(), v.trim()),
  }),
]);
