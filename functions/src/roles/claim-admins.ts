import { getAuth, type UserRecord } from 'firebase-admin/auth';
import {
  FieldValue,
  getFirestore,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type QuerySnapshot,
  type WriteResult,
} from 'firebase-admin/firestore';
import { roleFromClaim, type Role } from '../auth/require-role.js';
import { readExtras, type StaffExtra } from '../auth/staff-extras.js';
import { revokeTimeMs } from '../auth/session-revocation.js';
import { isTeamRole, TEAM_ROLES, type TeamRole } from './team-roles.js';

/** A person whose Auth claim is admin or staff. */
export interface ClaimMember {
  readonly uid: string;
  readonly email: string;
  readonly role: TeamRole;
  readonly extras: StaffExtra[];
  /** Super Admin (ATS-372). */
  readonly owner: boolean;
}

const LIST_PAGE_SIZE = 1000;
const MAX_LIST_PAGES = 20;

export function readRole(claims: UserRecord['customClaims']): Role {
  if (!claims || typeof claims !== 'object') return 'user';
  return roleFromClaim((claims as { role?: unknown }).role);
}

/** Extra access switched on for a staff member (ATS-368). Admins and normal accounts have none stored. */
export function readClaimExtras(claims: UserRecord['customClaims']): StaffExtra[] {
  if (!claims || typeof claims !== 'object') return [];
  return readExtras((claims as { extras?: unknown }).extras);
}

/**
 * Super Admin (ATS-372): `owner: true` next to `role: 'admin'`. Set only by the setup script, and
 * no one can change a Super Admin's access from the website.
 */
export function readClaimOwner(claims: UserRecord['customClaims']): boolean {
  if (!claims || typeof claims !== 'object') return false;
  return (claims as { owner?: unknown }).owner === true && readRole(claims) === 'admin';
}

/** The claims without `extras`: a role change starts the person with no extra access. */
export function claimsWithoutExtras(claims: UserRecord['customClaims']): Record<string, unknown> {
  const { extras: _dropped, ...rest } = (claims ?? {}) as Record<string, unknown>;
  return rest;
}

/**
 * Auth custom claims are the source of truth. Mirror documents may be missing
 * for someone who was given access outside this repo.
 *
 * Prefer {@link listTeamViaMirrors} for the Settings list: a full
 * `listUsers` scan grows with every shopper account and routinely takes
 * seconds. Keep this scan for last-admin checks and bootstrap healing.
 */
export async function listClaimTeam(): Promise<readonly ClaimMember[]> {
  const auth = getAuth();
  const members: ClaimMember[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result = await auth.listUsers(LIST_PAGE_SIZE, pageToken);
    for (const user of result.users) {
      const role = readRole(user.customClaims);
      if (!isTeamRole(role)) continue;
      members.push({
        uid: user.uid,
        email: (user.email ?? '').trim().toLowerCase(),
        role,
        extras: readClaimExtras(user.customClaims),
        owner: readClaimOwner(user.customClaims),
      });
    }
    if (!result.pageToken) return members;
    pageToken = result.pageToken;
  }

  return members;
}

export interface ListedMember {
  readonly uid: string;
  readonly email: string;
  readonly role: TeamRole;
  /** Staff only: the extras in their claim. */
  readonly extras: StaffExtra[];
  /** Super Admin (ATS-372). */
  readonly owner: boolean;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

const GET_USERS_CHUNK = 100;

function listedMemberFromMirror(
  uid: string,
  email: string,
  role: TeamRole,
  extras: StaffExtra[],
  owner: boolean,
  data: DocumentData | undefined,
): ListedMember {
  const mirrorMatches = data?.['role'] === role;
  const updatedBy = data?.['updatedBy'];
  return {
    uid,
    email,
    role,
    extras: role === 'staff' ? extras : [],
    owner: role === 'admin' && owner,
    updatedAt: mirrorMatches ? timestampToIso(data?.['updatedAt']) : null,
    updatedBy: mirrorMatches && typeof updatedBy === 'string' ? updatedBy : null,
  };
}

/**
 * Fast path for the Team table: read `roles` where role is admin or staff
 * (O(team)), then check each uid's claim via getUsers; the claim decides the role shown.
 * Falls back to a full Auth scan only when the mirror index is empty or every
 * mirror is stale, and heals mirrors so the next open stays fast.
 *
 * Console-only claim grants that never wrote `roles/{uid}` stay invisible while
 * at least one mirrored member still verifies — run set-admin (or Add to Team again,
 * which writes the missing mirror) so the mirror exists.
 */
export async function listTeamViaMirrors(): Promise<readonly ListedMember[]> {
  const db = getFirestore();
  const auth = getAuth();
  const mirrorSnap = await readTeamMirrors();

  if (!mirrorSnap.empty) {
    const byUid = new Map(mirrorSnap.docs.map((doc) => [doc.id, doc.data()] as const));
    const uids = [...byUid.keys()];
    const users: UserRecord[] = [];

    for (let i = 0; i < uids.length; i += GET_USERS_CHUNK) {
      const chunk = uids.slice(i, i + GET_USERS_CHUNK);
      const result = await auth.getUsers(chunk.map((uid) => ({ uid })));
      users.push(...result.users);
    }

    const members: ListedMember[] = [];
    for (const user of users) {
      const role = readRole(user.customClaims);
      if (!isTeamRole(role)) continue;
      members.push(
        listedMemberFromMirror(
          user.uid,
          (user.email ?? '').trim().toLowerCase(),
          role,
          readClaimExtras(user.customClaims),
          readClaimOwner(user.customClaims),
          byUid.get(user.uid),
        ),
      );
    }

    if (members.some((member) => member.role === 'admin')) {
      // The Team page lists the mirrors live (ATS-372) and calls this once in the background,
      // so fix any mirror that no longer matches its claim: a removed claim, a deleted account,
      // a failed rollback, or extras and Super Admin out of step.
      await reconcileTeamMirrors(members, mirrorSnap);
      return members;
    }
  }

  const claimMembers = await listClaimTeam();
  await reconcileTeamMirrors(claimMembers, mirrorSnap);
  const snaps =
    claimMembers.length > 0
      ? await db.getAll(...claimMembers.map((member) => db.doc(`roles/${member.uid}`)))
      : [];

  return claimMembers.map((member, index) =>
    listedMemberFromMirror(
      member.uid,
      member.email,
      member.role,
      member.extras,
      member.owner,
      snaps[index]?.data(),
    ),
  );
}

/** The Team list shows the mirror (ATS-372), so its role, extras and Super Admin must match the claim. */
function mirrorMatchesClaim(
  data: DocumentData | undefined,
  role: TeamRole,
  extras: readonly StaffExtra[],
  owner: boolean,
): boolean {
  if (!data || data['role'] !== role) return false;
  const mirrorExtras = readExtras(data['extras']);
  const sameExtras =
    mirrorExtras.length === extras.length && mirrorExtras.every((extra) => extras.includes(extra));
  return sameExtras && (data['owner'] === true) === owner;
}

/** The admin and staff mirrors. Read them before the claims and pass them to reconcileTeamMirrors. */
export async function readTeamMirrors(): Promise<QuerySnapshot> {
  return getFirestore()
    .collection('roles')
    .where('role', 'in', [...TEAM_ROLES])
    .get();
}

/**
 * Makes `roles/{uid}` match the admin and staff claims so the Team list and the last-admin
 * transaction see the right people. Does not write an audit record.
 * Claim holders missing a mirror, or with a mirror out of step (role, extras, Super Admin), get
 * theirs fixed. Mirror docs that still say admin or staff after the claim was removed are marked
 * as regular accounts.
 * It never overwrites a newer save (ATS-375): `teamSnap` must be read before the claims, a mirror
 * changed since it was read is skipped, and so is one written in the last 2 minutes. So a mirror
 * can stay out of step for a moment; the next Team open fixes it.
 */
export async function reconcileTeamMirrors(
  claimMembers: readonly Pick<ClaimMember, 'uid' | 'email' | 'role' | 'extras' | 'owner'>[],
  teamSnap: QuerySnapshot,
): Promise<void> {
  const db = getFirestore();
  const claimRoles = new Map(claimMembers.map((member) => [member.uid, member.role] as const));
  const existing = teamSnap;
  const snaps = new Map<string, DocumentSnapshot>(existing.docs.map((doc) => [doc.id, doc] as const));
  const missing = claimMembers.filter((member) => !snaps.has(member.uid));
  if (missing.length > 0) {
    const extra = await db.getAll(...missing.map((member) => db.doc(`roles/${member.uid}`)));
    for (const snap of extra) snaps.set(snap.id, snap);
  }

  const writes: Promise<void>[] = [];
  for (const member of claimMembers) {
    const extras = member.role === 'staff' ? member.extras : [];
    const owner = member.role === 'admin' && member.owner;
    const snap = snaps.get(member.uid);
    if (mirrorMatchesClaim(snap?.data(), member.role, extras, owner)) continue;
    writes.push(
      repairMirror(db.doc(`roles/${member.uid}`), snap, true, {
        role: member.role,
        email: member.email,
        extras,
        owner,
      }),
    );
  }

  for (const doc of existing.docs) {
    if (claimRoles.has(doc.id)) continue;
    writes.push(repairMirror(doc.ref, doc, true, { role: 'user' }));
  }

  await Promise.all(writes);
}

/**
 * A role change writes the mirror a moment before the claim, so a mirror written this recently may
 * be ahead of the claims just read. Leave it; the next Team open fixes it if it is still wrong.
 */
const RECENT_MIRROR_MS = 2 * 60 * 1000;

const NOT_FOUND = 5;
const ALREADY_EXISTS = 6;
const FAILED_PRECONDITION = 9;

/**
 * Rewrites one mirror only if it is unchanged since `snap` was read (ATS-375): a mirror saved by
 * setUserRole or setStaffExtras in the meantime wins, and this repair is skipped. `skipRecent`
 * leaves a mirror written in the last 2 minutes alone (background repair only).
 */
async function repairMirror(
  ref: DocumentReference,
  snap: DocumentSnapshot | undefined,
  skipRecent: boolean,
  fields: Record<string, unknown>,
): Promise<void> {
  const data = { ...fields, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'claim' };
  try {
    if (snap?.exists && snap.updateTime) {
      if (skipRecent && Date.now() - snap.updateTime.toMillis() < RECENT_MIRROR_MS) return;
      await ref.update(data, { lastUpdateTime: snap.updateTime });
    } else {
      await ref.create(data);
    }
  } catch (error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    // Someone changed, created or deleted the mirror after it was read: theirs is newer.
    if (code === FAILED_PRECONDITION || code === ALREADY_EXISTS || code === NOT_FOUND) return;
    throw error;
  }
}

/** Writes one team member's mirror when it is missing or out of step with their claim. */
export async function reconcileOneMirror(
  uid: string,
  email: string,
  role: TeamRole,
  claims: UserRecord['customClaims'],
): Promise<void> {
  const ref = getFirestore().doc(`roles/${uid}`);
  const extras = role === 'staff' ? readClaimExtras(claims) : [];
  const owner = role === 'admin' && readClaimOwner(claims);
  const snap = await ref.get();
  if (mirrorMatchesClaim(snap.data(), role, extras, owner)) return;
  // An admin just asked for this person: fix it now, even if the mirror was written moments ago.
  await repairMirror(ref, snap, false, { role, email, extras, owner });
}

export function timestampToIso(value: unknown): string | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/**
 * Ends the account's current sign-in and records the Auth revocation time
 * on `roles/{uid}` so security rules can reject the old ID token.
 */
export async function recordSessionRevocation(uid: string): Promise<void> {
  const auth = getAuth();
  await auth.revokeRefreshTokens(uid);
  const refreshed = await auth.getUser(uid);
  await getFirestore()
    .doc(`roles/${uid}`)
    .set({ revokeTimeMs: revokeTimeMs(refreshed.tokensValidAfterTime) }, { merge: true });
}

export async function revertRoleMirror(
  uid: string,
  role: Role,
  email: string,
  actor: string,
  auditPath: string,
  extras: readonly StaffExtra[] = [],
): Promise<WriteResult[]> {
  const db = getFirestore();
  const batch = db.batch();
  batch.set(
    db.doc(`roles/${uid}`),
    {
      role,
      email,
      extras: [...extras],
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );
  batch.delete(db.doc(auditPath));
  return batch.commit();
}
