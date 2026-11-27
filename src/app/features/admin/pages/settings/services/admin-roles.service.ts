import { Service } from '@angular/core';
import {
  collection,
  FirestoreDataConverter,
  limit,
  orderBy,
  query,
  Query,
  QueryDocumentSnapshot,
  Timestamp,
  where,
} from 'firebase/firestore';
import * as v from 'valibot';
import { callableFrom, injectFirestore, injectFunctionsAsync } from '@core/firebase';
import { AdminRecord, AssignableRole, RoleAudit, SetUserRoleResult } from '../models/admin-role.model';
import type { StaffExtra } from '@core/services/auth/staff-extras';
import {
  ListAdminsSchema,
  RoleAuditSchema,
  SetStaffExtrasResultSchema,
  SetUserRoleResultSchema,
  TeamMirrorSchema,
} from '../schemas/admin-role.schema';

/** More than the team will ever hold; the list is not paged. */
const TEAM_LIMIT = 100;

@Service()
export class AdminRolesService {
  readonly #functions = injectFunctionsAsync();
  readonly #firestore = injectFirestore();

  async listAdmins(): Promise<readonly AdminRecord[]> {
    const listAdmins = await callableFrom<Record<string, never>, unknown>(this.#functions(), 'listAdmins');
    const result = await listAdmins({});
    const parsed = v.safeParse(ListAdminsSchema, result.data);
    if (!parsed.success) {
      throw new Error('The admin list came back in an unexpected shape. Please try again.');
    }
    return parsed.output;
  }

  async setUserRole(email: string, role: AssignableRole): Promise<SetUserRoleResult> {
    const setUserRole = await callableFrom<{ email: string; role: AssignableRole }, unknown>(
      this.#functions(),
      'setUserRole',
    );
    const result = await setUserRole({
      email: email.trim().toLowerCase(),
      role,
    });
    const parsed = v.safeParse(SetUserRoleResultSchema, result.data);
    if (!parsed.success) {
      throw new Error('The update finished, but the response was unexpected. Refresh the page.');
    }
    return parsed.output;
  }

  /** Extra access for one staff member (ATS-368): the full list to keep on. */
  async setStaffExtras(email: string, extras: readonly StaffExtra[]): Promise<SetUserRoleResult> {
    const setStaffExtras = await callableFrom<{ email: string; extras: StaffExtra[] }, unknown>(
      this.#functions(),
      'setStaffExtras',
    );
    const result = await setStaffExtras({ email: email.trim().toLowerCase(), extras: [...extras] });
    const parsed = v.safeParse(SetStaffExtrasResultSchema, result.data);
    if (!parsed.success) {
      throw new Error('The update finished, but the response was unexpected. Refresh the page.');
    }
    return parsed.output;
  }

  /**
   * The Team list straight from the `roles` mirrors (ATS-372), live. Opening Team no longer waits for
   * the `listAdmins` function to start up. The Auth claim still decides what each person may do.
   */
  teamQuery(): Query<AdminRecord | null> {
    return query(
      collection(this.#firestore, 'roles').withConverter(teamMirrorConverter),
      where('role', 'in', ['admin', 'staff']),
      limit(TEAM_LIMIT),
    );
  }

  auditLogsQuery(): Query<RoleAudit | null> {
    return query(
      collection(this.#firestore, 'auditLogs').withConverter(roleAuditConverter),
      orderBy('at', 'desc'),
      limit(20),
    );
  }
}

function toIso(value: Timestamp | Date | string | null): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

const teamMirrorConverter: FirestoreDataConverter<AdminRecord | null> = {
  toFirestore() {
    return {};
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): AdminRecord | null {
    // A pending server time reads as Firestore's local estimate, never null.
    const parsed = v.safeParse(TeamMirrorSchema, snapshot.data({ serverTimestamps: 'estimate' }));
    if (!parsed.success) return null;
    const mirror = parsed.output;
    return {
      uid: snapshot.id,
      email: mirror.email.toLowerCase(),
      role: mirror.role,
      extras: mirror.role === 'staff' ? mirror.extras : [],
      owner: mirror.role === 'admin' && mirror.owner,
      updatedAt: toIso(mirror.updatedAt),
      updatedBy: mirror.updatedBy,
    };
  },
};

const roleAuditConverter: FirestoreDataConverter<RoleAudit | null> = {
  toFirestore() {
    return {};
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): RoleAudit | null {
    // Early role changes were saved without `action`.
    const parsed = v.safeParse(RoleAuditSchema, { action: 'role.set', ...snapshot.data(), id: snapshot.id });
    return parsed.success ? parsed.output : null;
  },
};
