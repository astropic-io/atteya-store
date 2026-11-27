import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminCallableOptions } from '../auth/callable-options.js';
import { requireRole } from '../auth/require-role.js';
import { removesExtra, type StaffExtra } from '../auth/staff-extras.js';
import {
  claimsWithoutExtras,
  listClaimTeam,
  listTeamViaMirrors,
  readClaimExtras,
  readClaimOwner,
  readRole,
  reconcileTeamMirrors,
  recordSessionRevocation,
  revertRoleMirror,
} from './claim-admins.js';
import { parseSetStaffExtrasInput, parseSetUserRoleInput } from './roles.validation.js';
import { endsSession, isLastAdminRemoval, type TeamRole } from './team-roles.js';

const LAST_ADMIN_MESSAGE = "You're the only admin. Add another admin before changing your access.";
const OWNER_MESSAGE = "This person is a Super Admin. Their access can't be changed from the website.";
const UNKNOWN_ACCOUNT_MESSAGE =
  'No account uses that email yet. Ask them to sign in once with Google, or add them under Authentication → Users first.';

/** One person on the Team table (admin or staff). */
export interface AdminRecord {
  readonly uid: string;
  readonly email: string;
  readonly role: TeamRole;
  /** Staff only: extra access switched on for them (ATS-368). */
  readonly extras: StaffExtra[];
  /** Super Admin (ATS-372): set only by the setup script; nobody can change them here. */
  readonly owner: boolean;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export interface SetUserRoleResult {
  readonly changed: boolean;
}

function isUserNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'auth/user-not-found'
  );
}

/**
 * Settings → Team: everyone with admin or staff access (the name stays `listAdmins`, so a
 * deploy never deletes and recreates the function). Admins only.
 */
export const listAdmins = onCall(adminCallableOptions(), async (request): Promise<AdminRecord[]> => {
  await requireRole(request, 'admin');

  // Mirror index + getUsers (O(team)). Full Auth listUsers only on bootstrap
  // or when every mirror is stale — see listTeamViaMirrors.
  const members = [...(await listTeamViaMirrors())];
  members.sort(
    (left, right) =>
      Number(right.role === 'admin') - Number(left.role === 'admin') || left.email.localeCompare(right.email),
  );
  return members;
});

export const setUserRole = onCall(adminCallableOptions(), async (request): Promise<SetUserRoleResult> => {
  const actor = await requireRole(request, 'admin');
  const input = parseSetUserRoleInput(request.data);

  let user;
  try {
    user = await getAuth().getUserByEmail(input.email);
  } catch (error: unknown) {
    if (isUserNotFound(error)) {
      throw new HttpsError('not-found', UNKNOWN_ACCOUNT_MESSAGE);
    }
    throw new HttpsError('internal', 'Could not look up that account. Please try again.');
  }

  // Super Admin (ATS-372): no admin can change or remove them, here or by calling the server directly.
  if (readClaimOwner(user.customClaims)) {
    throw new HttpsError('failed-precondition', OWNER_MESSAGE);
  }

  const before = readRole(user.customClaims);
  if (before === input.role) {
    return { changed: false };
  }

  const claimTeam = await listClaimTeam();
  const otherClaimAdmins = claimTeam.filter(
    (member) => member.role === 'admin' && member.uid !== user.uid,
  ).length;
  if (isLastAdminRemoval(before, input.role, otherClaimAdmins)) {
    throw new HttpsError('failed-precondition', LAST_ADMIN_MESSAGE);
  }

  await reconcileTeamMirrors(claimTeam);

  const db = getFirestore();
  const auditRef = db.collection('auditLogs').doc();
  const actorLabel = actor.email ?? actor.uid;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection('roles').where('role', '==', 'admin'));
    const otherMirrorAdmins = snap.docs.filter((doc) => doc.id !== user.uid).length;
    if (isLastAdminRemoval(before, input.role, otherMirrorAdmins)) {
      throw new HttpsError('failed-precondition', LAST_ADMIN_MESSAGE);
    }

    tx.set(
      db.doc(`roles/${user.uid}`),
      {
        role: input.role,
        email: input.email,
        // A new role starts with no extra access (ATS-368).
        extras: [],
        owner: false,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorLabel,
      },
      { merge: true },
    );
    tx.set(auditRef, {
      action: 'role.set',
      targetUid: user.uid,
      targetEmail: input.email,
      from: before,
      to: input.role,
      actorUid: actor.uid,
      actorEmail: actorLabel,
      at: FieldValue.serverTimestamp(),
    });
  });

  try {
    await getAuth().setCustomUserClaims(user.uid, {
      ...claimsWithoutExtras(user.customClaims),
      role: input.role,
    });
    // staff → user is covered by endsSession; staff → admin keeps every extra, so no sign-out.
    if (endsSession(before, input.role)) {
      await recordSessionRevocation(user.uid);
    }
  } catch {
    try {
      await getAuth().setCustomUserClaims(user.uid, {
        ...(user.customClaims ?? {}),
        role: before,
      });
    } catch {
      // The claim write did not stick. The mirror rollback still runs.
    }
    try {
      await revertRoleMirror(
        user.uid,
        before,
        input.email,
        actorLabel,
        auditRef.path,
        readClaimExtras(user.customClaims),
      );
    } catch {
      // The next role change reconciles the mirror.
    }
    throw new HttpsError('internal', 'Could not update dashboard access. Please try again.');
  }

  return { changed: true };
});

export interface SetStaffExtrasResult {
  readonly changed: boolean;
}

/**
 * Settings → Team, Extra Access (ATS-368): switch Refunds, Delete Orders and Sales Money on or off
 * for one staff member. Admins only. `extras` is the full list to keep on. Switching one off ends
 * that person's current sign-in, because their ID token keeps the old claim for up to an hour.
 */
export const setStaffExtras = onCall(
  adminCallableOptions(),
  async (request): Promise<SetStaffExtrasResult> => {
    const actor = await requireRole(request, 'admin');
    const input = parseSetStaffExtrasInput(request.data);

    let user;
    try {
      user = await getAuth().getUserByEmail(input.email);
    } catch (error: unknown) {
      if (isUserNotFound(error)) {
        throw new HttpsError('not-found', UNKNOWN_ACCOUNT_MESSAGE);
      }
      throw new HttpsError('internal', 'Could not look up that account. Please try again.');
    }

    if (readRole(user.customClaims) !== 'staff') {
      throw new HttpsError(
        'failed-precondition',
        'Extra access is only for Staff. Admins already have it all.',
      );
    }

    const before = readClaimExtras(user.customClaims);
    if (before.length === input.extras.length && before.every((extra) => input.extras.includes(extra))) {
      return { changed: false };
    }

    // Read the claims again right before writing, so a role change made meanwhile (Remove Access,
    // Make Admin) is never undone by this save.
    const fresh = await getAuth().getUser(user.uid);
    if (readRole(fresh.customClaims) !== 'staff') {
      throw new HttpsError(
        'failed-precondition',
        'This person is no longer Staff. Refresh the page and try again.',
      );
    }
    const freshBefore = readClaimExtras(fresh.customClaims);

    const db = getFirestore();
    const auditRef = db.collection('auditLogs').doc();
    const actorLabel = actor.email ?? actor.uid;

    // Claim first, then the mirror: the mirror write wakes the person's browser to refresh its token,
    // and that refresh must already see the new extras.
    try {
      await getAuth().setCustomUserClaims(user.uid, {
        ...claimsWithoutExtras(fresh.customClaims),
        ...(input.extras.length > 0 ? { extras: input.extras } : {}),
      });
    } catch {
      throw new HttpsError('internal', 'Could not update extra access. Please try again.');
    }

    try {
      const batch = db.batch();
      batch.set(
        db.doc(`roles/${user.uid}`),
        { extras: input.extras, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorLabel },
        { merge: true },
      );
      batch.set(auditRef, {
        action: 'extras.set',
        targetUid: user.uid,
        targetEmail: input.email,
        from: freshBefore,
        to: input.extras,
        actorUid: actor.uid,
        actorEmail: actorLabel,
        at: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } catch {
      try {
        await getAuth().setCustomUserClaims(user.uid, fresh.customClaims ?? {});
      } catch {
        // The claim did not roll back. The next save sets it again.
      }
      throw new HttpsError('internal', 'Could not update extra access. Please try again.');
    }

    if (removesExtra(freshBefore, input.extras)) {
      try {
        await recordSessionRevocation(user.uid);
      } catch {
        // The claim is already narrower; the old token still expires within the hour.
        throw new HttpsError(
          'internal',
          'Extra access was saved, but they may keep the old access for up to an hour. Ask them to sign out and sign in again.',
        );
      }
    }

    return { changed: true };
  },
);
