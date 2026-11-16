import { Inject, Injectable } from '@nestjs/common';
import {
  type AccountExport,
  type DeletionRequestResponse,
  ErrorCodes,
  type LastOwnerConflictDetails,
  type MediaMime,
  type ReportReason,
} from '@caselind/contracts';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { MessageExtrasService } from '../messaging/message-extras.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import {
  auditEvents,
  deliveries,
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
  kycProfiles,
  kycSubmissions,
  orgMembers,
  paymentPins,
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
import { WalletService } from '../ledger/wallet.service.js';
import { HealthService } from '../health/health.service.js';
import { GamesService } from '../games/games.service.js';
import { SchoolService } from '../school/school.service.js';
import { TwoFactorService } from '../auth/identity/two-factor.service.js';

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
    private readonly wallets: WalletService,
    private readonly twoFactor: TwoFactorService,
    private readonly messageExtras: MessageExtrasService,
    private readonly healthData: HealthService,
    private readonly games: GamesService,
    private readonly school: SchoolService,
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
      // Identity documents are not listed (nor linked) in the export: the kyc section carries statuses and dates only.
      .where(and(eq(mediaAssets.ownerUserId, auth.userId), sql`${mediaAssets.purpose} <> 'kyc_document'`))
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
      .where(
        and(
          eq(messages.senderId, auth.userId),
          isNull(messages.recalledAt),
          sql`(${messages.expiresAt} IS NULL OR ${messages.expiresAt} > now())`,
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(EXPORT_MESSAGES_MAX + 1);
    const messagesSentTruncated = sentRows.length > EXPORT_MESSAGES_MAX;
    // The most recent ones, returned oldest first.
    const sentKept = sentRows.slice(0, EXPORT_MESSAGES_MAX).reverse();

    // Lot 3b: favourite messages the user can still reach.
    const favoriteMessages = await this.messageExtras.exportFavorites(auth.userId);

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

    // Lot 8: deliveries of the user's orders and the ones the user carried; never the proof code nor a position.
    const deliveryRows = await this.db
      .select({ d: deliveries, number: orders.number })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .where(or(eq(deliveries.buyerId, auth.userId), eq(deliveries.courierId, auth.userId)))
      .orderBy(asc(deliveries.createdAt), asc(deliveries.id));

    const wallet = await this.wallets.exportFor(auth.userId);
    const services = await this.exportServices(auth.userId);
    const mobility = await this.exportMobility(auth.userId);
    const aiConversations = await this.exportAiConversations(auth.userId);
    const listingRows = await this.db.execute<{ id: string; kind: string; title: string; description: string; price_minor: string | null; currency: string | null; city: string; status: string; created_at: Date }>(sql`
      SELECT id, kind, title, description, price_minor, currency, city, status, created_at FROM listings WHERE owner_id = ${auth.userId}::uuid ORDER BY created_at, id`);
    const cvRows = await this.db.execute<AccountExport['jobProfile'] & object>(sql`
      SELECT headline, summary, skills, city, experience, education FROM job_profiles WHERE user_id = ${auth.userId}::uuid`);
    const jobAlertRows = await this.db.execute<{ id: string; q: string | null; city: string | null; contract_type: string | null; created_at: Date }>(sql`
      SELECT id, q, city, contract_type, created_at FROM job_alerts WHERE user_id = ${auth.userId}::uuid ORDER BY created_at`);
    const jobAppRows = await this.db.execute<{ id: string; title: string; org_name: string; status: string; message: string; created_at: Date }>(sql`
      SELECT a.id, j.title, o.name AS org_name, a.status, a.message, a.created_at FROM job_applications a
      JOIN job_postings j ON j.id = a.posting_id JOIN organizations o ON o.id = j.org_id
      WHERE a.user_id = ${auth.userId}::uuid ORDER BY a.created_at, a.id`);
    const frMissions = await this.db.execute<{ id: string; title: string; budget_minor: string; currency: string; status: string; created_at: Date }>(sql`
      SELECT id, title, budget_minor, currency, status, created_at FROM missions WHERE client_id = ${auth.userId}::uuid ORDER BY created_at, id`);
    const frProposals = await this.db.execute<{ id: string; title: string; amount_minor: string; delivery_days: number; message: string; status: string; created_at: Date }>(sql`
      SELECT p.id, m.title, p.amount_minor, p.delivery_days, p.message, p.status, p.created_at FROM mission_proposals p JOIN missions m ON m.id = p.mission_id
      WHERE p.freelancer_id = ${auth.userId}::uuid ORDER BY p.created_at, p.id`);
    const frContracts = await this.db.execute<{ id: string; title: string; client_id: string; handle: string; amount_minor: string; currency: string; status: string; created_at: Date }>(sql`
      SELECT c.id, m.title, c.client_id, CASE WHEN c.client_id = ${auth.userId}::uuid THEN fu.handle::text ELSE cu.handle::text END AS handle,
        c.amount_minor, c.currency, c.status, c.created_at
      FROM freelance_contracts c JOIN missions m ON m.id = c.mission_id JOIN users cu ON cu.id = c.client_id JOIN users fu ON fu.id = c.freelancer_id
      WHERE c.client_id = ${auth.userId}::uuid OR c.freelancer_id = ${auth.userId}::uuid ORDER BY c.created_at, c.id`);
    const eduAuthored = await this.db.execute<{ id: string; title: string; status: string; created_at: Date }>(sql`
      SELECT id, title, status, created_at FROM courses WHERE author_id = ${auth.userId}::uuid ORDER BY created_at, id`);
    const eduEnrollments = await this.myEnrollmentsAll(auth.userId);
    const budgetRows = await this.db.execute<{ currency: string; limit_minor: string }>(sql`
      SELECT currency, limit_minor FROM budgets WHERE user_id = ${auth.userId}::uuid ORDER BY currency`);
    // Lot 10: mini-app authorizations (history included); never a token.
    const miniappGrants = await this.exportMiniAppGrants(auth.userId);
    // Lot 6B: KYC level and request statuses/dates; never the document number nor the files.
    const [kycProfile] = await this.db.select({ level: kycProfiles.level }).from(kycProfiles).where(eq(kycProfiles.userId, auth.userId)).limit(1);
    const kycRows = await this.db
      .select({ id: kycSubmissions.id, level: kycSubmissions.level, status: kycSubmissions.status, createdAt: kycSubmissions.createdAt, decidedAt: kycSubmissions.decidedAt })
      .from(kycSubmissions)
      .where(eq(kycSubmissions.userId, auth.userId))
      .orderBy(asc(kycSubmissions.createdAt), asc(kycSubmissions.id));
    const [pinRow] = await this.db.select({ id: paymentPins.userId }).from(paymentPins).where(eq(paymentPins.userId, auth.userId)).limit(1);

    // Lot 7: the user's own search history.
    const searchRows = await this.db.execute(sql`
      SELECT query, scope, created_at FROM search_history WHERE user_id = ${auth.userId}::uuid ORDER BY created_at, id`);

    // Lot 1c: status and enrolment date only, never the secret nor the backup codes.
    const twoFactor = await this.twoFactor.exportStatus(auth.userId);
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
      ...twoFactor,
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
      favoriteMessages,
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
      deliveries: deliveryRows.map(({ d, number }) => ({
        orderNumber: number,
        role: (d.buyerId === auth.userId ? 'buyer' : 'courier') as 'buyer' | 'courier',
        status: d.status,
        rating: d.rating,
        ratingComment: d.ratingComment,
        failureReason: d.failureReason,
        createdAt: d.createdAt.toISOString(),
        deliveredAt: d.deliveredAt?.toISOString() ?? null,
      })),
      cart: cartRows.map((c) => ({ variantId: c.variantId, quantity: c.quantity, addedAt: c.createdAt.toISOString() })),
      kyc: {
        level: (kycProfile?.level ?? 0) as 0 | 1 | 2,
        hasPaymentPin: pinRow !== undefined,
        submissions: kycRows.map((k) => ({
          id: k.id,
          level: k.level,
          status: k.status,
          submittedAt: k.createdAt.toISOString(),
          decidedAt: k.decidedAt?.toISOString() ?? null,
        })),
      },
      reviews: reviewRows.map((r) => ({
        id: r.id,
        productId: r.productId,
        rating: r.rating,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
      })),
      wallet,
      services,
      mobility,
      miniappGrants,
      aiConversations,
      listings: listingRows.rows.map((l) => ({
        id: l.id,
        kind: l.kind,
        title: l.title,
        description: l.description,
        priceMinor: l.price_minor === null ? null : Number(l.price_minor),
        currency: l.currency,
        city: l.city,
        status: l.status,
        createdAt: new Date(l.created_at).toISOString(),
      })),
      jobProfile: cvRows.rows[0] ?? null,
      jobAlerts: jobAlertRows.rows.map((a) => ({ id: a.id, q: a.q, city: a.city, contractType: a.contract_type, createdAt: new Date(a.created_at).toISOString() })),
      jobApplications: jobAppRows.rows.map((a) => ({ id: a.id, jobTitle: a.title, orgName: a.org_name, status: a.status, message: a.message, createdAt: new Date(a.created_at).toISOString() })),
      freelance: {
        missions: frMissions.rows.map((m) => ({ id: m.id, title: m.title, budgetMinor: Number(m.budget_minor), currency: m.currency.trim(), status: m.status, createdAt: new Date(m.created_at).toISOString() })),
        proposals: frProposals.rows.map((p) => ({ id: p.id, missionTitle: p.title, amountMinor: Number(p.amount_minor), deliveryDays: p.delivery_days, message: p.message, status: p.status, createdAt: new Date(p.created_at).toISOString() })),
        contracts: frContracts.rows.map((c) => ({ id: c.id, missionTitle: c.title, role: c.client_id === auth.userId ? 'client' : 'freelancer', counterpartyHandle: c.handle, amountMinor: Number(c.amount_minor), currency: c.currency.trim(), status: c.status, createdAt: new Date(c.created_at).toISOString() })),
      },
      health: await this.healthData.exportFor(auth.userId),
      games: await this.games.exportFor(auth.userId),
      school: await this.school.exportFor(auth.userId),
      education: {
        authored: eduAuthored.rows.map((c) => ({ id: c.id, title: c.title, status: c.status, createdAt: new Date(c.created_at).toISOString() })),
        enrollments: eduEnrollments,
        reviews: (await this.db.execute<{ title: string; rating: number; body: string; created_at: Date }>(sql`SELECT c.title, rv.rating, rv.body, rv.created_at FROM course_reviews rv JOIN courses c ON c.id = rv.course_id WHERE rv.user_id = ${auth.userId}::uuid ORDER BY rv.created_at, rv.id`)).rows.map((r) => ({ courseTitle: r.title, rating: r.rating, body: r.body, createdAt: new Date(r.created_at).toISOString() })),
        exams: (await this.db.execute<{ title: string; score_percent: number; used: number; started_at: Date }>(sql`SELECT c.title, x.score_percent, round(extract(epoch FROM (x.finished_at - x.started_at)))::int AS used, x.started_at FROM exam_sessions x JOIN courses c ON c.id = x.course_id WHERE x.user_id = ${auth.userId}::uuid AND x.finished_at IS NOT NULL ORDER BY x.started_at, x.id`)).rows.map((r) => ({ courseTitle: r.title, scorePercent: r.score_percent, usedSeconds: r.used, startedAt: new Date(r.started_at).toISOString() })),
      },
      budgets: budgetRows.rows.map((b) => ({ currency: b.currency, limitMinor: Number(b.limit_minor) })),
      searchHistory: (searchRows.rows as { query: string; scope: 'all' | 'users' | 'orgs' | 'products' | 'posts'; created_at: string | Date }[]).map((r) => ({
        query: r.query,
        scope: r.scope,
        createdAt: new Date(r.created_at).toISOString(),
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

  /** Lot 12: own assistant conversations with their messages (private to the user; never provider keys). */
  private async exportAiConversations(userId: string): Promise<AccountExport['aiConversations']> {
    const iso = (v: string | Date): string => new Date(v).toISOString();
    const convs = await this.db.execute(sql`SELECT id, title, created_at FROM ai_conversations WHERE user_id = ${userId}::uuid ORDER BY created_at, id`);
    const msgs = await this.db.execute(sql`
      SELECT m.conversation_id, m.role, m.content, m.model_id, m.created_at FROM ai_messages m
      JOIN ai_conversations c ON c.id = m.conversation_id WHERE c.user_id = ${userId}::uuid ORDER BY m.created_at, m.id`);
    type M = { conversation_id: string; role: 'user' | 'assistant'; content: string; model_id: string | null; created_at: string | Date };
    return (convs.rows as { id: string; title: string; created_at: string | Date }[]).map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: iso(c.created_at),
      messages: (msgs.rows as M[]).filter((m) => m.conversation_id === c.id).map((m) => ({ role: m.role, content: m.content, modelId: m.model_id, createdAt: iso(m.created_at) })),
    }));
  }

  private async exportMiniAppGrants(userId: string): Promise<AccountExport['miniappGrants']> {
    const res = await this.db.execute(sql`
      SELECT g.app_id, a.name, g.scopes, g.created_at, g.revoked_at FROM miniapp_grants g JOIN miniapps a ON a.id = g.app_id
      WHERE g.user_id = ${userId}::uuid ORDER BY g.created_at, g.app_id`);
    return (res.rows as { app_id: string; name: string; scopes: string[]; created_at: string | Date; revoked_at: string | Date | null }[]).map((r) => ({
      appId: r.app_id,
      appName: r.name,
      scopes: r.scopes,
      grantedAt: new Date(r.created_at).toISOString(),
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
    }));
  }

  /** Lot 17a: every enrollment of the user (the export is not paginated). */
  private async myEnrollmentsAll(userId: string): Promise<AccountExport['education']['enrollments']> {
    const res = await this.db.execute<{ title: string; done: number; total: number; completed: boolean; code: string | null; enrolled_at: Date }>(sql`
      SELECT c.title, e.enrolled_at, (e.completed_at IS NOT NULL) AS completed,
        (SELECT count(*)::int FROM lesson_progress p WHERE p.enrollment_id = e.id) AS done,
        (SELECT count(*)::int FROM course_lessons l WHERE l.course_id = e.course_id) AS total,
        (SELECT ce.code FROM certificates ce WHERE ce.enrollment_id = e.id) AS code
      FROM course_enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = ${userId}::uuid ORDER BY e.enrolled_at, e.id`);
    return res.rows.map((r) => ({
      courseTitle: r.title,
      progressPercent: r.total === 0 ? 0 : Math.floor((r.done * 100) / r.total),
      completed: r.completed,
      certificateCode: r.code,
      enrolledAt: new Date(r.enrolled_at).toISOString(),
    }));
  }

  /** Lot 11: own driver profile, rides (both roles), favourite places and trusted contacts. */
  private async exportMobility(userId: string): Promise<AccountExport['mobility']> {
    const iso = (v: string | Date): string => new Date(v).toISOString();
    const [driver, rides, favs, trusted] = await Promise.all([
      this.db.execute(sql`SELECT status, vehicle_kind, make, plate, color, zone, created_at FROM mobility_drivers WHERE user_id = ${userId}::uuid`),
      this.db.execute(sql`
        SELECT id, rider_id, status, vehicle, pickup_label, dropoff_label, fare_minor, final_fare_minor, currency, est_distance_km, actual_distance_km, created_at, completed_at
        FROM mobility_rides WHERE rider_id = ${userId}::uuid OR driver_id = ${userId}::uuid ORDER BY created_at, id`),
      this.db.execute(sql`SELECT kind, label, address, lat, lng FROM mobility_favorite_places WHERE user_id = ${userId}::uuid ORDER BY created_at, id`),
      this.db.execute(sql`SELECT u.handle FROM mobility_trusted_contacts t JOIN users u ON u.id = t.contact_user_id WHERE t.user_id = ${userId}::uuid ORDER BY t.created_at`),
    ]);
    const d = driver.rows[0] as { status: string; vehicle_kind: string; make: string; plate: string; color: string; zone: string; created_at: string | Date } | undefined;
    type R = { id: string; rider_id: string; status: string; vehicle: string; pickup_label: string; dropoff_label: string; fare_minor: string | number; final_fare_minor: string | number | null; currency: string; est_distance_km: number; actual_distance_km: number; created_at: string | Date; completed_at: string | Date | null };
    return {
      driver: d ? { status: d.status, vehicleKind: d.vehicle_kind, make: d.make, plate: d.plate, color: d.color, zone: d.zone, createdAt: iso(d.created_at) } : null,
      rides: (rides.rows as R[]).map((r) => ({
        id: r.id,
        role: (r.rider_id === userId ? 'rider' : 'driver') as 'rider' | 'driver',
        status: r.status,
        vehicle: r.vehicle,
        pickupLabel: r.pickup_label,
        dropoffLabel: r.dropoff_label,
        fareMinor: Number(r.fare_minor),
        finalFareMinor: r.final_fare_minor === null ? null : Number(r.final_fare_minor),
        currency: r.currency.trim(),
        distanceKm: r.actual_distance_km >= 0.1 ? r.actual_distance_km : r.est_distance_km,
        createdAt: iso(r.created_at),
        completedAt: r.completed_at ? iso(r.completed_at) : null,
      })),
      favoritePlaces: favs.rows as { kind: string; label: string; address: string; lat: number; lng: number }[],
      trustedContacts: (trusted.rows as { handle: string }[]).map((t) => ({ handle: t.handle })),
    };
  }

  /** Lot 9: own provider profile and offers, own bookings as a client, own service reviews. */
  private async exportServices(userId: string): Promise<AccountExport['services']> {
    const iso = (v: string | Date): string => new Date(v).toISOString();
    const [profile, offers, bookings, reviews] = await Promise.all([
      this.db.execute(sql`SELECT display_name, bio, city, skills, created_at FROM service_providers WHERE user_id = ${userId}::uuid`),
      this.db.execute(sql`SELECT id, title, status, created_at FROM service_offers WHERE provider_id = ${userId}::uuid ORDER BY created_at, id`),
      this.db.execute(sql`
        SELECT b.id, s.title, b.status, b.starts_at, b.note, b.created_at FROM service_bookings b
        JOIN service_offers s ON s.id = b.offer_id WHERE b.client_id = ${userId}::uuid ORDER BY b.created_at, b.id`),
      this.db.execute(sql`SELECT id, offer_id, rating, body, created_at FROM service_reviews WHERE client_id = ${userId}::uuid ORDER BY created_at, id`),
    ]);
    const p = profile.rows[0] as { display_name: string; bio: string | null; city: string | null; skills: string[]; created_at: string | Date } | undefined;
    return {
      profile: p ? { displayName: p.display_name, bio: p.bio, city: p.city, skills: p.skills, createdAt: iso(p.created_at) } : null,
      offers: (offers.rows as { id: string; title: string; status: string; created_at: string | Date }[]).map((o) => ({
        id: o.id,
        title: o.title,
        status: o.status,
        createdAt: iso(o.created_at),
      })),
      bookings: (bookings.rows as { id: string; title: string; status: string; starts_at: string | Date; note: string | null; created_at: string | Date }[]).map((b) => ({
        id: b.id,
        offerTitle: b.title,
        status: b.status,
        startsAt: iso(b.starts_at),
        note: b.note,
        createdAt: iso(b.created_at),
      })),
      reviews: (reviews.rows as { id: string; offer_id: string; rating: number; body: string | null; created_at: string | Date }[]).map((r) => ({
        id: r.id,
        offerId: r.offer_id,
        rating: r.rating,
        body: r.body,
        createdAt: iso(r.created_at),
      })),
    };
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
