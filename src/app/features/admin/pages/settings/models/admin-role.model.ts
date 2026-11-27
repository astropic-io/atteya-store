import * as v from 'valibot';
import type { StaffExtra } from '@core/services/auth/staff-extras';
import { AdminRecordSchema, RoleAuditSchema, SetUserRoleResultSchema } from '../schemas/admin-role.schema';

export type AdminRecord = v.InferOutput<typeof AdminRecordSchema>;
export type RoleAudit = v.InferOutput<typeof RoleAuditSchema>;
export type SetUserRoleResult = v.InferOutput<typeof SetUserRoleResultSchema>;
/** Admin: the whole dashboard. Staff: everyday work, plus any extras switched on for them (ATS-368). */
export type TeamRole = 'admin' | 'staff';
export type AssignableRole = TeamRole | 'user';

export interface AdminTableRow {
  readonly id: string;
  readonly email: string;
  readonly role: TeamRole;
  readonly extras: readonly StaffExtra[];
  /** Super Admin (ATS-372): shown, but nobody can change them from the website. */
  readonly owner: boolean;
  readonly roleLabel: string;
  readonly since: string;
  readonly grantedBy: string;
  readonly action: string;
}
