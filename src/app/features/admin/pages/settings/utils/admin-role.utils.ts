import { Timestamp } from 'firebase/firestore';
import { shortOrderRef } from '@core/services/orders/order-ref';
import { firebaseErrors } from '@shared/utils/firebase/firebase-errors';
import type { StaffExtra } from '@core/services/auth/staff-extras';
import { AdminRecord, AdminTableRow, AssignableRole, RoleAudit, TeamRole } from '../models/admin-role.model';

const WHEN_FORMAT = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return WHEN_FORMAT.format(date);
}

export function adminSinceLabel(updatedAt: string | null): string {
  if (!updatedAt) return 'Not recorded';
  return formatDate(new Date(updatedAt));
}

export function grantedByLabel(updatedBy: string | null): string {
  if (!updatedBy) return 'Not recorded';
  if (updatedBy === 'cli') return 'Setup script';
  if (updatedBy === 'claim') return 'Already had access';
  return updatedBy;
}

export function teamRoleLabel(role: TeamRole): string {
  return role === 'admin' ? 'Admin' : 'Staff';
}

/** Names and one-line hints for the extra access switches (ATS-368). */
export const STAFF_EXTRA_COPY: Record<StaffExtra, { readonly label: string; readonly hint: string }> = {
  refunds: { label: 'Refunds', hint: 'Mark refunds as sent and send back return fees' },
  deleteOrders: { label: 'Delete orders', hint: 'Remove a cancelled or failed order for good' },
  money: { label: 'Sales money', hint: 'See money totals on Overview' },
};

/** "Staff", or "Staff + Refunds, Sales money" when extras are switched on. */
export function teamMemberLabel(role: TeamRole, extras: readonly StaffExtra[]): string {
  if (role !== 'staff' || extras.length === 0) return teamRoleLabel(role);
  return `Staff + ${extras.map((extra) => STAFF_EXTRA_COPY[extra].label).join(', ')}`;
}

function extrasList(extras: readonly StaffExtra[]): string {
  return extras.map((extra) => STAFF_EXTRA_COPY[extra].label).join(', ');
}

export function toAdminTableRow(admin: AdminRecord): AdminTableRow {
  return {
    id: admin.uid,
    email: admin.email || 'No email on the account',
    role: admin.role,
    extras: admin.role === 'staff' ? admin.extras : [],
    owner: admin.role === 'admin' && admin.owner,
    roleLabel:
      admin.role === 'admin' && admin.owner
        ? 'Super Admin'
        : teamMemberLabel(admin.role, admin.role === 'staff' ? admin.extras : []),
    since: adminSinceLabel(admin.updatedAt),
    grantedBy: grantedByLabel(admin.updatedBy),
    action: '',
  };
}

function actorLabel(actorEmail: string): string {
  if (actorEmail === 'cli') return 'The setup script';
  if (!actorEmail) return 'Someone on the team';
  return actorEmail;
}

const ACCESS_NAME: Record<AssignableRole, string> = {
  admin: 'Admin',
  staff: 'Staff',
  user: 'no',
};

/** One line in Recent changes: a role change, a deleted order or a deleted product. */
export function describeRoleChange(entry: RoleAudit): string {
  const actor = actorLabel(entry.actorEmail);
  switch (entry.action) {
    case 'order.delete':
      return `${actor} deleted order ${shortOrderRef(entry.orderId)}.`;
    case 'product.delete':
      return `${actor} deleted the product ${entry.name || entry.productId}.`;
    case 'owner.set':
      return entry.to
        ? `${actor} made ${entry.targetEmail} a Super Admin.`
        : `${actor} made ${entry.targetEmail} a regular Admin again.`;
    case 'extras.set': {
      const added = entry.to.filter((extra) => !entry.from.includes(extra));
      const removed = entry.from.filter((extra) => !entry.to.includes(extra));
      const parts = [
        added.length > 0 ? `gave ${entry.targetEmail} ${extrasList(added)}` : '',
        removed.length > 0 ? `took ${extrasList(removed)} away from ${entry.targetEmail}` : '',
      ].filter(Boolean);
      return parts.length > 0
        ? `${actor} ${parts.join(' and ')}.`
        : `${actor} saved extra access for ${entry.targetEmail}.`;
    }
    case 'role.set':
      if (entry.to === 'user') {
        return `${actor} removed dashboard access from ${entry.targetEmail}.`;
      }
      if (entry.from === 'user') {
        return `${actor} gave ${entry.targetEmail} ${ACCESS_NAME[entry.to]} access.`;
      }
      return `${actor} changed ${entry.targetEmail} from ${ACCESS_NAME[entry.from]} to ${ACCESS_NAME[entry.to]}.`;
  }
}

export function formatAuditWhen(value: RoleAudit['at']): string {
  if (value instanceof Timestamp) return formatDate(value.toDate());
  if (value instanceof Date) return formatDate(value);
  return formatDate(new Date(value));
}

function isSdkStatusMessage(message: string, bareCode: string): boolean {
  const normalized = message.trim().toLowerCase();
  const code = bareCode.toLowerCase();
  return normalized === code || normalized.startsWith(`${code} (`) || normalized.startsWith(`${code}:`);
}

export function roleActionError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && 'code' in error) {
    const message = (error as { message?: unknown }).message;
    const code = (error as { code?: unknown }).code;
    if (typeof message === 'string' && typeof code === 'string' && code.startsWith('functions/')) {
      const bareCode = code.slice('functions/'.length);
      if (message.length > 0 && !isSdkStatusMessage(message, bareCode)) {
        return message;
      }
      if (bareCode === 'internal' || bareCode === 'unknown' || bareCode === 'unavailable') {
        return 'That did not work. Please try again.';
      }
    }
  }
  return firebaseErrors(error);
}
