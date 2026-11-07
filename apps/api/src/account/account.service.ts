import { Inject, Injectable } from '@nestjs/common';
import {
  type AccountExport,
  type DeletionRequestResponse,
  ErrorCodes,
  type LastOwnerConflictDetails,
  type MediaMime,
  type ReportReason,
} from '@caselind/contracts';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import {
  auditEvents,
  conversationMembers,
  conversations,
  mediaAssets,
  messages,
  cartItems,
  orderItems,
  orders,
  reviews,
  organizations,
  follows,
  orgMembers,
  postComments,
  posts,
  reports,
  sessions,
  stories,
  users,
} from '../db/schema.js';
import { contentUrlOf } from '../media/media.service.js';
import type { Tx } from '../orgs/orgs.service.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import { PasswordService } from '../security/password.service.js';
import { UsersService } from '../users/users.service.js';

const DAY_MS = 86_400_000;
/** The export carries at most this many sent messages (the most recent ones). */
const EXPORT_MESSAGES_MAX = 10_000;

/** Right of access (export) and right of erasure (deletion request) for the signed-in user. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly passwords: PasswordService,
    private readonly users: UsersService,
    private readonly privacy: PrivacyService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Everything held about the caller. Columns are selected explicitly so that password hashes,
   * refresh-token hashes, OTP codes and audit metadata can never leak into the export.
   */
  async export(auth: AuthUser, meta: RequestMeta): Promise<AccountExport> {
    const [profile, privacy, blocks] = await Promise.all([
      this.users.me(auth.userId),
      this.privacy.getSettings(auth.userId),
      this.privacy.listBlocks(auth.userId),
    ]);
    const sessionRows = await this.db
      .select({
        id: sessions.id,
        deviceName: sessions.deviceName,
        platform: sessions.platform,
        ip: sessions.ip,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, auth.userId))
      .orderBy(desc(sessions.createdAt));
    const eventRows = await this.db
      .select({
        action: auditEvents.action,
        occurredAt: auditEvents.occurredAt,
        ip: auditEvents.ip,
        userAgent: auditEvents.userAgent,
      })
      .from(auditEvents)
      .where(eq(auditEvents.subjectUserId, auth.userId))
      .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id));
    // Memberships and pending invitations, with the org's public identity only.
    const membershipRows = await this.db
      .select({
        orgId: orgMembers.orgId,
        slug: organizations.slug,
        name: organizations.name,
        role: orgMembers.role,
        status: orgMembers.status,
        joinedAt: orgMembers.joinedAt,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(eq(orgMembers.userId, auth.userId))
      .orderBy(asc(orgMembers.createdAt), asc(orgMembers.orgId));
    // Never the storage key (internal object location) nor the checksum.
    const mediaRows = await this.db
      .select({
        id: mediaAssets.id,
        purpose: mediaAssets.purpose,
        mime: mediaAssets.mime,
        sizeBytes: mediaAssets.sizeBytes,
        status: mediaAssets.status,
        createdAt: mediaAssets.createdAt,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.ownerUserId, auth.userId))
      .orderBy(asc(mediaAssets.createdAt), asc(mediaAssets.id));

    // Lot 3A: the conversations the user is in, and what they wrote (recalled and system messages excluded).
    const conversationRows = await this.db
      .select({ id: conversations.id, kind: conversations.kind, role: conversationMembers.role, joinedAt: conversationMembers.joinedAt })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.userId, auth.userId), eq(conversationMembers.status, 'active')))
      .orderBy(asc(conversationMembers.joinedAt), asc(conversations.id));
    const sentRows = await this.db
      .select({ id: messages.id, conversationId: messages.conversationId, kind: messages.kind, body: messages.body, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.senderId, auth.userId), isNull(messages.recalledAt)))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(EXPORT_MESSAGES_MAX + 1);
    const messagesSentTruncated = sentRows.length > EXPORT_MESSAGES_MAX;
    // The most recent ones, returned oldest first.
    const sentKept = sentRows.slice(0, EXPORT_MESSAGES_MAX).reverse();

    // Lot 4B: the user's stories (archive included) and the reports they filed.
    const storyRows = await this.db
      .select({ id: stories.id, caption: stories.caption, createdAt: stories.createdAt, expiresAt: stories.expiresAt })
      .from(stories)
      .where(eq(stories.authorId, auth.userId))
      .orderBy(asc(stories.createdAt), asc(stories.id));
    const reportRows = await this.db
      .select()
      .from(reports)
      .where(eq(reports.reporterId, auth.userId))
      .orderBy(asc(reports.createdAt), asc(reports.id));

    // Lot 4A: own (non-deleted) posts and comments, and the accounts followed.
    const postRows = await this.db
      .select({ id: posts.id, body: posts.body, visibility: posts.visibility, createdAt: posts.createdAt })
      .from(posts)
      .where(and(eq(posts.authorId, auth.userId), isNull(posts.deletedAt)))
      .orderBy(asc(posts.createdAt), asc(posts.id));
    const commentRows = await this.db
      .select({ id: postComments.id, postId: postComments.postId, body: postComments.body, createdAt: postComments.createdAt })
      .from(postComments)
      .where(and(eq(postComments.authorId, auth.userId), isNull(postComments.deletedAt)))
      .orderBy(asc(postComments.createdAt), asc(postComments.id));
    const followingRows = await this.db
      .select({ userId: follows.followeeId, handle: sql<string>`${users.handle}::text`, followedAt: follows.createdAt })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followeeId))
      .where(eq(follows.followerId, auth.userId))
      .orderBy(asc(follows.createdAt), asc(follows.followeeId));

    // Lot 5B: the user's orders (their own address, no data about other people) and reviews.
    const orderRows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.buyerId, auth.userId))
      .orderBy(asc(orders.createdAt), asc(orders.id));
    const orderItemRows =
      orderRows.length > 0
        ? await this.db
            .select()
            .from(orderItems)
            .where(inArray(orderItems.orderId, orderRows.map((o) => o.id)))
            .orderBy(asc(orderItems.title), asc(orderItems.id))
        : [];
    const cartRows = await this.db
      .select({ variantId: cartItems.variantId, quantity: cartItems.quantity, createdAt: cartItems.createdAt })
      .from(cartItems)
      .where(eq(cartItems.userId, auth.userId))
      .orderBy(asc(cartItems.createdAt), asc(cartItems.variantId));
    const reviewRows = await this.db
      .select({ id: reviews.id, productId: reviews.productId, rating: reviews.rating, body: reviews.body, createdAt: reviews.createdAt })
      .from(reviews)
      .where(eq(reviews.userId, auth.userId))
      .orderBy(asc(reviews.createdAt), asc(reviews.id));

    const result: AccountExport = {
      exportedAt: new Date().toISOString(),
      profile,
      privacy,
      sessions: sessionRows.map((s) => ({
        id: s.id,
        deviceName: s.deviceName,
        platform: s.platform,
        ip: s.ip,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        revokedAt: s.revokedAt?.toISOString() ?? null,
      })),
      blocks,
      securityEvents: eventRows.map((e) => ({
        action: e.action,
        occurredAt: e.occurredAt.toISOString(),
        ip: e.ip,
        userAgent: e.userAgent,
      })),
      orgMemberships: membershipRows.map((m) => ({
        orgId: m.orgId,
        slug: m.slug,
        name: m.name,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt?.toISOString() ?? null,
      })),
      media: mediaRows.map((m) => ({
        id: m.id,
        purpose: m.purpose,
        mime: (m.mime as MediaMime | null) ?? null,
        sizeBytes: m.sizeBytes,
        status: m.status,
        contentUrl: m.status === 'ready' ? contentUrlOf(m.id) : null,
        createdAt: m.createdAt.toISOString(),
      })),
      conversations: conversationRows.map((c) => ({ id: c.id, kind: c.kind, role: c.role, joinedAt: c.joinedAt.toISOString() })),
      messagesSent: sentKept.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        kind: m.kind,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
      messagesSentTruncated,
      posts: postRows.map((p) => ({ id: p.id, body: p.body, visibility: p.visibility, createdAt: p.createdAt.toISOString() })),
      comments: commentRows.map((c) => ({ id: c.id, postId: c.postId, body: c.body, createdAt: c.createdAt.toISOString() })),
      following: followingRows.map((f) => ({ userId: f.userId, handle: f.handle, followedAt: f.followedAt.toISOString() })),
      stories: storyRows.map((s) => ({
        id: s.id,
        caption: s.caption,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
      reportsFiled: reportRows.map((r) => ({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason as ReportReason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      orders: orderRows.map((o) => ({
        number: o.number,
        status: o.status,
        totalMinor: o.totalMinor,
        currency: o.currency.trim(),
        createdAt: o.createdAt.toISOString(),
        address: o.address ?? null,
        items: orderItemRows
          .filter((i) => i.orderId === o.id)
          .map((i) => ({ title: i.title, variantLabel: i.variantLabel, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor })),
      })),
      cart: cartRows.map((c) => ({ variantId: c.variantId, quantity: c.quantity, addedAt: c.createdAt.toISOString() })),
      reviews: reviewRows.map((r) => ({
        id: r.id,
        productId: r.productId,
        rating: r.rating,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
      })),
    };
    await this.audit.record({
      action: 'user.data_exported',
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      meta,
    });
    return result;
  }

  /**
   * Schedules the deletion after ACCOUNT_DELETION_GRACE_DAYS and signs the user out everywhere.
   * A wrong password is a plain 401: it does not count towards the login lockout (the caller
   * already holds a valid session; the global rate limit still applies).
   *
   * Refused with 409 `last_owner` (nothing changes) while the caller is the last active owner of an
   * active organisation: ownership must be transferred (or another owner added) first, otherwise
   * the purge would leave the org without an owner. See lastOwnedOrgs for the locking.
   */
  async requestDeletion(auth: AuthUser, password: string, meta: RequestMeta): Promise<DeletionRequestResponse> {
    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    if (!user) throw AppError.unauthenticated();
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new AppError(401, ErrorCodes.invalidCredentials, 'Incorrect password');
    }

    const requestedAt = new Date();
    await this.db.transaction(async (tx) => {
      const orphaned = await this.lastOwnedOrgs(tx, auth.userId);
      if (orphaned.length > 0) {
        const details: LastOwnerConflictDetails = { reason: 'last_owner', orgs: orphaned };
        throw AppError.conflict(
          'You are the last owner of one or more organizations: transfer ownership or add another owner first',
          details,
        );
      }
      await tx.update(users).set({ deletionRequestedAt: requestedAt }).where(eq(users.id, auth.userId));
      await tx
        .update(sessions)
        .set({ revokedAt: requestedAt, revokeReason: 'account_deletion_requested' })
        .where(and(eq(sessions.userId, auth.userId), isNull(sessions.revokedAt)));
    });
    this.realtime.disconnectUser(auth.userId);
    const deletionScheduledFor = new Date(requestedAt.getTime() + this.env.ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
    await this.audit.record({
      action: 'user.deletion_requested',
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      meta,
      metadata: { deletionScheduledFor: deletionScheduledFor.toISOString() },
    });
    return { deletionScheduledFor: deletionScheduledFor.toISOString() };
  }

  /**
   * Active organisations of which `userId` is the only eligible active owner (same definition as
   * OrgMembersService.hasOtherActiveOwner: co-owners with a pending deletion or an inactive account
   * do not count).
   *
   * Locking: every org the user actively owns is first locked FOR UPDATE, in id order, before the
   * user row is written. OrgMembersService locks the org row before anything else (and
   * assertOwnerQuota locks the user row after it), so this keeps the same org -> user order (no
   * deadlock) and serialises with concurrent role changes, removals and acceptances in those orgs.
   * The owner count runs in a second statement so it sees everything committed before the locks
   * were granted (READ COMMITTED takes a new snapshot per statement).
   *
   * Suspended orgs never block: their members are read-only (ownership cannot be transferred), so
   * blocking would make deletion impossible. The purge records them as orphaned instead.
   */
  private async lastOwnedOrgs(tx: Tx, userId: string): Promise<LastOwnerConflictDetails['orgs']> {
    await tx.execute(sql`
      SELECT o.id FROM organizations o
      JOIN org_members m ON m.org_id = o.id
      WHERE m.user_id = ${userId} AND m.role = 'owner' AND m.status = 'active'
      ORDER BY o.id
      FOR UPDATE OF o`);
    const res = await tx.execute<{ id: string; slug: string; name: string }>(sql`
      SELECT o.id, o.slug::text AS slug, o.name FROM organizations o
      JOIN org_members m ON m.org_id = o.id
      WHERE m.user_id = ${userId} AND m.role = 'owner' AND m.status = 'active' AND o.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM org_members m2 JOIN users u ON u.id = m2.user_id
          WHERE m2.org_id = o.id AND m2.user_id <> ${userId} AND m2.role = 'owner' AND m2.status = 'active'
            AND u.status = 'active' AND u.deletion_requested_at IS NULL
        )
      ORDER BY o.slug`);
    return res.rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
  }
}
