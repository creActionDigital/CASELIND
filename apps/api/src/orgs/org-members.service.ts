import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  type InviteOrgMemberRequest,
  type MyOrgMembership,
  type OrgMember,
  type OrgMemberList,
  type OrgMemberListQuery,
  type OrgRole,
} from '@caselind/contracts';
import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { organizations, orgMembers, type OrgMemberRow, users } from '../db/schema.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { orgNotFound, UUID_RE } from './org.guard.js';
import { ADMIN_LEVEL_ROLES, type OrgPermissionKey, roleHasPermission } from './org-permissions.js';
import { assertOwnerQuota, toMyMembership, type Tx } from './orgs.service.js';

const memberNotFound = () => AppError.notFound('Member not found');
const invitationNotFound = () => AppError.notFound('Invitation not found');
const lastOwner = () =>
  AppError.conflict('An organization must keep at least one active owner', { reason: 'last_owner' });

/** Opaque members cursor: the last row's (created_at, user_id), full microsecond precision. */
function encodeMemberCursor(createdAt: string, userId: string): string {
  return Buffer.from(JSON.stringify([createdAt, userId])).toString('base64url');
}

function decodeMemberCursor(cursor: string): { createdAt: string; userId: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      !Number.isNaN(Date.parse(v[0])) &&
      typeof v[1] === 'string' &&
      UUID_RE.test(v[1])
    ) {
      return { createdAt: v[0], userId: v[1] };
    }
  } catch {
    // fall through
  }
  throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
    { path: 'cursor', message: 'invalid cursor' },
  ]);
}

const memberColumns = {
  userId: orgMembers.userId,
  handle: users.handle,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  role: orgMembers.role,
  status: orgMembers.status,
  invitedBy: orgMembers.invitedBy,
  createdAt: orgMembers.createdAt,
  joinedAt: orgMembers.joinedAt,
};

interface MemberRow {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: OrgRole;
  status: 'invited' | 'active';
  invitedBy: string | null;
  createdAt: Date;
  joinedAt: Date | null;
}

function toOrgMember(r: MemberRow): OrgMember {
  return {
    userId: r.userId,
    handle: r.handle,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    role: r.role,
    status: r.status,
    invitedBy: r.invitedBy,
    createdAt: r.createdAt.toISOString(),
    joinedAt: r.joinedAt?.toISOString() ?? null,
  };
}

const isAdminLevel = (role: OrgRole) => ADMIN_LEVEL_ROLES.includes(role);

/**
 * Members, invitations and roles.
 *
 * Every mutation runs in one transaction that first locks the organizations row (FOR UPDATE).
 * That serialises all membership changes of one org, which is what makes the "at least one
 * active owner" rule hold under concurrency: two owners demoting each other at the same time
 * cannot both see "another owner remains". Under that lock the actor's own membership is read
 * again, so a role changed between OrgGuard and the transaction is honoured.
 */
@Injectable()
export class OrgMembersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly privacy: PrivacyService,
  ) {}

  /** Oldest first. Keyset pagination on (created_at, user_id) so pages never overlap. */
  async list(orgId: string, q: OrgMemberListQuery): Promise<OrgMemberList> {
    const filters = [eq(orgMembers.orgId, orgId)];
    if (q.status) filters.push(eq(orgMembers.status, q.status));
    if (q.cursor) {
      const c = decodeMemberCursor(q.cursor);
      filters.push(sql`(${orgMembers.createdAt}, ${orgMembers.userId}) > (${c.createdAt}::timestamptz, ${c.userId}::uuid)`);
    }
    const rows = await this.db
      .select({
        ...memberColumns,
        // Exact timestamp (microseconds) for the cursor; a JS Date would truncate to ms.
        createdAtExact: sql<string>`${orgMembers.createdAt}::text`,
      })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(...filters))
      .orderBy(asc(orgMembers.createdAt), asc(orgMembers.userId))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => toOrgMember(r)),
      nextCursor: rows.length > q.limit && last ? encodeMemberCursor(last.createdAtExact, last.userId) : null,
    };
  }

  /**
   * Invites by handle. The invitee must be an active account (no pending deletion) with no block
   * in either direction with the inviter; otherwise the same 404 as an unknown handle, so an
   * invitation can't be used to probe blocks. Granting owner/admin needs `org.admins.manage`.
   */
  async invite(orgId: string, actorId: string, req: InviteOrgMemberRequest, meta: RequestMeta): Promise<OrgMember> {
    return this.db.transaction(async (tx) => {
      const actorRole = await this.lockOrgAndActor(tx, orgId, actorId, 'org.members.manage');
      if (isAdminLevel(req.role) && !roleHasPermission(actorRole, 'org.admins.manage')) {
        throw AppError.forbidden('Only owners can grant the owner or admin role');
      }

      const [target] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.handle, req.handle), eq(users.status, 'active'), isNull(users.deletionRequestedAt)))
        .limit(1);
      if (!target || (target.id !== actorId && (await this.privacy.isBlockedEitherWay(actorId, target.id)))) {
        throw AppError.notFound('User not found');
      }

      const inserted = await tx
        .insert(orgMembers)
        .values({ orgId, userId: target.id, role: req.role, status: 'invited', invitedBy: actorId })
        .onConflictDoNothing()
        .returning({ userId: orgMembers.userId });
      if (inserted.length === 0) {
        throw AppError.conflict('This user is already a member or invited', { reason: 'already_member' });
      }

      await this.audit.record(
        { action: 'org.member_invited', actorUserId: actorId, meta, metadata: { orgId, userId: target.id, role: req.role } },
        tx,
      );
      return this.memberIn(tx, orgId, target.id);
    });
  }

  /** Accepting an owner invitation counts against the invitee's owner quota. Suspended org: 403. */
  async accept(orgId: string, userId: string, meta: RequestMeta): Promise<MyOrgMembership> {
    if (!UUID_RE.test(orgId)) throw invitationNotFound();
    return this.db.transaction(async (tx) => {
      const org = await this.lockOrg(tx, orgId);
      if (!org) throw invitationNotFound();
      const invitation = await this.pendingInvitation(tx, orgId, userId);
      if (org.status === 'suspended') throw AppError.forbidden('This organization is suspended');
      if (invitation.role === 'owner') await assertOwnerQuota(tx, userId);

      const [m] = await tx
        .update(orgMembers)
        .set({ status: 'active', joinedAt: new Date() })
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
        .returning();
      await this.audit.record(
        { action: 'org.invitation_accepted', actorUserId: userId, meta, metadata: { orgId, role: m!.role } },
        tx,
      );
      return toMyMembership(org, m!);
    });
  }

  /** Declining deletes the invitation; the org may invite again later. Allowed even if suspended. */
  async decline(orgId: string, userId: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(orgId)) throw invitationNotFound();
    await this.db.transaction(async (tx) => {
      const org = await this.lockOrg(tx, orgId);
      if (!org) throw invitationNotFound();
      const invitation = await this.pendingInvitation(tx, orgId, userId);
      await tx.delete(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
      await this.audit.record(
        { action: 'org.invitation_declined', actorUserId: userId, meta, metadata: { orgId, role: invitation.role } },
        tx,
      );
    });
  }

  /**
   * Needs `org.members.manage`; touching an owner/admin (as the current or the new role) needs
   * `org.admins.manage`. Demoting the last active owner: 409. Works on pending invitations too
   * (changes the role that will be granted on acceptance).
   */
  async changeRole(orgId: string, actorId: string, targetId: string, role: OrgRole, meta: RequestMeta): Promise<OrgMember> {
    if (!UUID_RE.test(targetId)) throw memberNotFound();
    return this.db.transaction(async (tx) => {
      const actorRole = await this.lockOrgAndActor(tx, orgId, actorId, 'org.members.manage');
      const target = await this.membership(tx, orgId, targetId);
      if (!target) throw memberNotFound();
      if ((isAdminLevel(target.role) || isAdminLevel(role)) && !roleHasPermission(actorRole, 'org.admins.manage')) {
        throw AppError.forbidden('Only owners can grant or change the owner or admin role');
      }
      if (target.role === role) return this.memberIn(tx, orgId, targetId);

      if (target.role === 'owner' && target.status === 'active' && !(await this.hasOtherActiveOwner(tx, orgId, targetId))) {
        throw lastOwner();
      }
      if (role === 'owner' && target.status === 'active') await assertOwnerQuota(tx, targetId);

      await tx
        .update(orgMembers)
        .set({ role })
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetId)));
      await this.audit.record(
        {
          action: 'org.member_role_changed',
          actorUserId: actorId,
          meta,
          metadata: { orgId, userId: targetId, from: target.role, to: role },
        },
        tx,
      );
      return this.memberIn(tx, orgId, targetId);
    });
  }

  /**
   * Removes a member or cancels an invitation. Removing yourself is leaving and needs no
   * permission; removing someone else needs `org.members.manage` (+ `org.admins.manage` for an
   * owner/admin). The last active owner can neither leave nor be removed: 409.
   */
  async remove(orgId: string, actorId: string, targetId: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(targetId)) throw memberNotFound();
    const self = targetId.toLowerCase() === actorId.toLowerCase();
    await this.db.transaction(async (tx) => {
      // Leaving stays possible in a suspended org (still subject to the last-owner rule below).
      const actorRole = await this.lockOrgAndActor(tx, orgId, actorId, self ? 'org.view' : 'org.members.manage', self);
      const target = await this.membership(tx, orgId, targetId);
      if (!target) throw memberNotFound();
      if (!self && isAdminLevel(target.role) && !roleHasPermission(actorRole, 'org.admins.manage')) {
        throw AppError.forbidden('Only owners can remove an owner or admin');
      }
      if (target.role === 'owner' && target.status === 'active' && !(await this.hasOtherActiveOwner(tx, orgId, targetId))) {
        throw lastOwner();
      }

      await tx.delete(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetId)));
      await this.audit.record(
        {
          action: 'org.member_removed',
          actorUserId: actorId,
          meta,
          metadata: { orgId, userId: targetId, role: target.role, status: target.status, self },
        },
        tx,
      );
    });
  }

  /* Helpers. All of them run inside the caller's transaction. */

  private async lockOrg(tx: Tx, orgId: string) {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for('update');
    return org;
  }

  /**
   * Locks the org, then re-reads the actor's active membership and re-checks `permission` and the
   * suspension (OrgGuard did the same without a lock). Returns the actor's current role.
   */
  private async lockOrgAndActor(
    tx: Tx,
    orgId: string,
    actorId: string,
    permission: OrgPermissionKey,
    allowSuspended = false,
  ): Promise<OrgRole> {
    const org = await this.lockOrg(tx, orgId);
    if (!org) throw orgNotFound();
    const actor = await this.membership(tx, orgId, actorId);
    if (!actor || actor.status !== 'active') throw orgNotFound();
    if (org.status === 'suspended' && !allowSuspended) throw AppError.forbidden('This organization is suspended');
    if (!roleHasPermission(actor.role, permission)) throw AppError.forbidden();
    return actor.role;
  }

  private async membership(tx: Tx, orgId: string, userId: string): Promise<OrgMemberRow | undefined> {
    const [m] = await tx
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
      .limit(1);
    return m;
  }

  private async pendingInvitation(tx: Tx, orgId: string, userId: string): Promise<OrgMemberRow> {
    const m = await this.membership(tx, orgId, userId);
    if (!m || m.status !== 'invited') throw invitationNotFound();
    return m;
  }

  /**
   * Another active owner whose account is itself active and has no pending deletion request. An
   * owner who asked for their account to be deleted does not count: otherwise the last "real" owner
   * could leave right after a co-owner's deletion request (which only checked that this one
   * remained), and the org would be left without an owner once the purge runs (ADR-012 addendum).
   * The co-owner's request and this check both run under the org row lock, so they serialise.
   */
  private async hasOtherActiveOwner(tx: Tx, orgId: string, exceptUserId: string): Promise<boolean> {
    const [row] = await tx
      .select({ n: count() })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(
        and(
          eq(orgMembers.orgId, orgId),
          eq(orgMembers.role, 'owner'),
          eq(orgMembers.status, 'active'),
          ne(orgMembers.userId, exceptUserId),
          eq(users.status, 'active'),
          isNull(users.deletionRequestedAt),
        ),
      );
    return (row?.n ?? 0) > 0;
  }

  private async memberIn(tx: Tx, orgId: string, userId: string): Promise<OrgMember> {
    const [r] = await tx
      .select(memberColumns)
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
      .limit(1);
    if (!r) throw memberNotFound();
    return toOrgMember(r);
  }
}
