import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminKycList,
  type AdminKycListQuery,
  type AdminKycSubmission,
  type CreateKycSubmissionRequest,
  ErrorCodes,
  type KycDecisionRequest,
  type KycIdType,
  type KycLevel,
  type KycLimitsView,
  type KycStatusView,
  type KycSubmission,
  type MediaMime,
} from '@caselind/contracts';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { kycProfiles, kycSubmissions, type KycSubmissionRow, mediaAssets, users } from '../db/schema.js';
import { contentUrlOf } from '../media/media.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { pgErrorOf } from '../orgs/orgs.service.js';
import { decodeCursor, encodeCursor, UUID_RE, validationError } from '../social/social.shared.js';
import { type KycLimits, KycPort, type KycTier } from '../wallet/kyc.port.js';
import { KycCrypto } from './kyc-crypto.js';
import { limitsForTier } from './kyc-limits.js';
import { PinService } from './pin.service.js';

const MIN_AGE_YEARS = 18;

const toSubmission = (r: KycSubmissionRow): KycSubmission => ({
  id: r.id,
  level: r.level as 1 | 2,
  status: r.status,
  legalName: r.legalName,
  birthDate: r.birthDate,
  idType: r.idType as KycIdType | null,
  idNumberLast4: r.idNumberLast4,
  city: r.city,
  documentIds: r.documentIds,
  decisionReason: r.decisionReason,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
});

/**
 * KYC tiers 0-2 with manual review by a platform admin (no identity provider is contracted).
 * Also the KycPort read by the ledger: limits per tier and currency.
 */
@Injectable()
export class KycService extends KycPort {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly crypto: KycCrypto,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly pins: PinService,
  ) {
    super();
  }

  async tierOf(userId: string): Promise<KycTier> {
    const [row] = await this.db.select({ level: kycProfiles.level }).from(kycProfiles).where(eq(kycProfiles.userId, userId)).limit(1);
    return (row?.level ?? 0) as KycTier;
  }

  override async limitsFor(userId: string, currency: string): Promise<KycLimits> {
    return limitsForTier(await this.tierOf(userId), currency, this.env.KYC_LIMITS);
  }

  private viewLimits(tier: KycTier): KycLimitsView[] {
    return this.env.COMMERCE_CURRENCIES.map((currency) => {
      const { maxBalanceMinor, maxSingleTransferMinor, maxDailyOutgoingMinor } = limitsForTier(tier, currency, this.env.KYC_LIMITS);
      return { currency, maxBalanceMinor, maxSingleTransferMinor, maxDailyOutgoingMinor };
    });
  }

  async getMine(userId: string): Promise<KycStatusView> {
    const level = await this.tierOf(userId);
    const rows = await this.db
      .select()
      .from(kycSubmissions)
      .where(eq(kycSubmissions.userId, userId))
      .orderBy(desc(kycSubmissions.createdAt), desc(kycSubmissions.id))
      .limit(10);
    const pending = rows.find((r) => r.status === 'pending');
    const decided = rows.find((r) => r.status !== 'pending');
    return {
      level: level as KycLevel,
      pending: pending ? toSubmission(pending) : null,
      lastDecision: decided ? toSubmission(decided) : null,
      limits: this.viewLimits(level),
      nextLevelLimits: level < 2 ? this.viewLimits((level + 1) as KycTier) : null,
      hasPaymentPin: await this.pins.has(userId),
    };
  }

  async submit(userId: string, sessionId: string, body: CreateKycSubmissionRequest, meta: RequestMeta): Promise<KycSubmission> {
    if (new Set(body.documentIds).size !== body.documentIds.length) throw validationError('documentIds', 'documents must be distinct');
    if (body.level === 1) {
      const birth = new Date(`${body.birthDate}T00:00:00Z`);
      const limit = new Date();
      limit.setUTCFullYear(limit.getUTCFullYear() - MIN_AGE_YEARS);
      if (Number.isNaN(birth.getTime()) || birth > limit) throw validationError('birthDate', `you must be at least ${MIN_AGE_YEARS}`);
    }
    const tier = await this.tierOf(userId);
    if (tier >= body.level) throw AppError.conflict('This verification level is already reached', { reason: 'already_verified' });
    if (body.level === 2 && tier < 1) throw AppError.conflict('Level 1 must be approved first', { reason: 'level_1_required' });
    await this.assertDocuments(userId, body);

    try {
      const row = await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(kycSubmissions)
          .values(
            body.level === 1
              ? {
                  userId,
                  level: 1,
                  legalName: body.legalName,
                  birthDate: body.birthDate,
                  idType: body.idType,
                  idNumberEnc: this.crypto.encrypt(userId, body.idNumber),
                  idNumberLast4: body.idNumber.slice(-4),
                  city: body.city,
                  documentIds: body.documentIds,
                }
              : { userId, level: 2, documentIds: body.documentIds },
          )
          .returning();
        // Level only: never the declared identity, the number or the files.
        await this.audit.record(
          { action: 'kyc.submitted', actorUserId: userId, sessionId, meta, metadata: { submissionId: inserted!.id, level: body.level } },
          tx,
        );
        return inserted!;
      });
      return toSubmission(row);
    } catch (err) {
      if (pgErrorOf(err)?.code === '23505') {
        throw AppError.conflict('A verification request is already pending', { reason: 'pending_exists' });
      }
      throw err;
    }
  }

  /** The files must be ready `kyc_document` uploads of the caller; identity document: image or PDF, selfie: image. */
  private async assertDocuments(userId: string, body: CreateKycSubmissionRequest): Promise<void> {
    const rows = await this.db
      .select({ id: mediaAssets.id, mime: mediaAssets.mime })
      .from(mediaAssets)
      .where(
        and(
          inArray(mediaAssets.id, body.documentIds),
          eq(mediaAssets.ownerUserId, userId),
          eq(mediaAssets.purpose, 'kyc_document'),
          eq(mediaAssets.status, 'ready'),
        ),
      );
    const mimeOf = new Map(rows.map((r) => [r.id, r.mime as MediaMime | null]));
    body.documentIds.forEach((id, i) => {
      if (!mimeOf.has(id)) throw validationError(`documentIds.${i}`, 'must be a ready upload with purpose "kyc_document"');
    });
    if (body.level === 1 && !mimeOf.get(body.documentIds[1]!)?.startsWith('image/')) {
      throw validationError('documentIds.1', 'the selfie must be an image');
    }
  }

  // --- Admin review ---

  async adminList(q: AdminKycListQuery): Promise<AdminKycList> {
    const conditions: SQL[] = [];
    if (q.status) conditions.push(sql`s.status = ${q.status}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      conditions.push(sql`(s.created_at, s.id) > (${c.ts}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<{ id: string; ts: string }>(sql`
      SELECT s.id, s.created_at::text AS ts FROM kyc_submissions s
      ${conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
      ORDER BY s.created_at, s.id LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    const items = await this.loadAdminViews(page.map((r) => r.id));
    const last = page.at(-1);
    return { items, nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  async adminGet(adminId: string, id: string, meta: RequestMeta): Promise<AdminKycSubmission> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Submission not found');
    const [view] = await this.loadAdminViews([id]);
    if (!view) throw AppError.notFound('Submission not found');
    await this.audit.record({ action: 'kyc.viewed', actorUserId: adminId, subjectUserId: view.userId, meta, metadata: { submissionId: id } });
    return view;
  }

  private async loadAdminViews(ids: string[]): Promise<AdminKycSubmission[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ s: kycSubmissions, handle: sql<string | null>`${users.handle}::text` })
      .from(kycSubmissions)
      .innerJoin(users, eq(users.id, kycSubmissions.userId))
      .where(inArray(kycSubmissions.id, ids))
      .orderBy(asc(kycSubmissions.createdAt), asc(kycSubmissions.id));
    return rows.map(({ s, handle }) => ({
      ...toSubmission(s),
      userId: s.userId,
      userHandle: handle,
      decidedBy: s.decidedBy,
      documents: s.documentIds.map((id) => ({ id, contentUrl: contentUrlOf(id) })),
    }));
  }

  async decide(adminId: string, sessionId: string, id: string, body: KycDecisionRequest, meta: RequestMeta): Promise<AdminKycSubmission> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Submission not found');
    const approve = body.decision === 'approve';
    const decided = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(kycSubmissions).where(eq(kycSubmissions.id, id)).for('update').limit(1);
      if (!row) throw AppError.notFound('Submission not found');
      if (row.userId === adminId) throw new AppError(403, ErrorCodes.forbidden, 'You cannot review your own verification request');
      if (row.status !== 'pending') throw AppError.conflict('This request was already decided', { reason: 'already_decided' });
      await tx
        .update(kycSubmissions)
        .set({ status: approve ? 'approved' : 'rejected', decidedBy: adminId, decidedAt: new Date(), decisionReason: body.reason ?? null })
        .where(eq(kycSubmissions.id, id));
      if (approve) {
        await tx.execute(sql`
          INSERT INTO kyc_profiles (user_id, level) VALUES (${row.userId}, ${row.level})
          ON CONFLICT (user_id) DO UPDATE SET level = GREATEST(kyc_profiles.level, EXCLUDED.level), updated_at = now()`);
      }
      await this.audit.record(
        {
          action: approve ? 'kyc.approved' : 'kyc.rejected',
          actorUserId: adminId,
          subjectUserId: row.userId,
          sessionId,
          meta,
          metadata: { submissionId: id, level: row.level, ...(body.reason ? { reason: body.reason } : {}) },
        },
        tx,
      );
      return row;
    });
    await this.notifications.notify({
      userId: decided.userId,
      category: 'security',
      title: approve ? 'Vérification d’identité approuvée' : 'Vérification d’identité refusée',
      body: approve
        ? `Votre compte est maintenant vérifié au niveau ${decided.level}.`
        : `Votre demande de niveau ${decided.level} a été refusée${body.reason ? ` : ${body.reason}` : '.'}`,
      data: { kind: 'kyc', submissionId: id },
      urgent: true,
    });
    const [view] = await this.loadAdminViews([id]);
    return view!;
  }
}
