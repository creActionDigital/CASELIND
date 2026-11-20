import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Campaign,
  CampaignList,
  CreateCampaignRequest,
  LoyaltyProgram,
  MyLoyalty,
  UpdateLoyaltyProgramRequest,
} from '@caselind/contracts';
import { CONSENT_VERSIONS } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { appendConsent } from '../consents/consents.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { Tx } from '../orgs/orgs.service.js';

// shortcut: one campaign reaches 500 opted-in customers at most (no batching), raise with a queue if shops outgrow it.
const MAX_RECIPIENTS = 500;

/** Loyalty points (a plain counter, no monetary value) and opt-in marketing campaigns (lot 16h). */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger('Loyalty');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async getProgram(orgId: string): Promise<LoyaltyProgram> {
    const { rows } = await this.db.execute<{ enabled: boolean; points_per_unit: number; currency: string; reward_text: string; members: string; issued: string }>(sql`
      SELECT COALESCE(p.enabled, false) AS enabled, COALESCE(p.points_per_unit, 1) AS points_per_unit, COALESCE(p.currency, 'USD') AS currency,
        COALESCE(p.reward_text, '') AS reward_text,
        (SELECT count(DISTINCT user_id) FROM loyalty_movements WHERE org_id = ${orgId}::uuid) AS members,
        (SELECT COALESCE(sum(points), 0) FROM loyalty_movements WHERE org_id = ${orgId}::uuid) AS issued
      FROM (SELECT 1) x LEFT JOIN loyalty_programs p ON p.org_id = ${orgId}::uuid`);
    const r = rows[0]!;
    return {
      enabled: r.enabled,
      pointsPerUnit: r.points_per_unit,
      currency: r.currency.trim() as 'USD' | 'CDF',
      rewardText: r.reward_text,
      members: Number(r.members),
      pointsIssued: Number(r.issued),
    };
  }

  async updateProgram(orgId: string, actorUserId: string, req: UpdateLoyaltyProgramRequest, meta: RequestMeta): Promise<LoyaltyProgram> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO loyalty_programs (org_id, enabled, points_per_unit, currency, reward_text)
        VALUES (${orgId}::uuid, ${req.enabled}, ${req.pointsPerUnit}, ${req.currency}, ${req.rewardText})
        ON CONFLICT (org_id) DO UPDATE SET enabled = EXCLUDED.enabled, points_per_unit = EXCLUDED.points_per_unit,
          currency = EXCLUDED.currency, reward_text = EXCLUDED.reward_text, updated_at = now()`);
      await this.audit.record(
        { action: 'commerce.loyalty_updated', actorUserId, meta, metadata: { orgId, enabled: req.enabled, pointsPerUnit: req.pointsPerUnit, currency: req.currency } },
        tx,
      );
    });
    return this.getProgram(orgId);
  }

  /**
   * Entry point called when an order becomes `delivered` (best effort, the caller swallows errors).
   * Points = floor(order total without delivery fee / 100) * pointsPerUnit, in the program currency only (USD and CDF
   * both have 2 decimals). Once per order (unique movement). Cancelling later does not take points back (deferred).
   */
  async awardForOrder(orderId: string, executor: Db | Tx = this.db): Promise<void> {
    await executor.execute(sql`
      INSERT INTO loyalty_movements (order_id, org_id, user_id, points)
      SELECT o.id, o.org_id, o.buyer_id, ((o.total_minor - o.delivery_fee_minor) / 100) * p.points_per_unit
      FROM orders o JOIN loyalty_programs p ON p.org_id = o.org_id AND p.enabled AND p.currency = o.currency
      WHERE o.id = ${orderId}::uuid AND ((o.total_minor - o.delivery_fee_minor) / 100) * p.points_per_unit > 0
      ON CONFLICT (order_id) DO NOTHING`);
  }

  async mine(userId: string): Promise<MyLoyalty> {
    const consent = await this.db.execute<{ opted_in: boolean }>(sql`SELECT opted_in FROM marketing_consents WHERE user_id = ${userId}::uuid`);
    const { rows } = await this.db.execute<{ org_id: string; name: string; points: string; reward_text: string | null; enabled: boolean | null }>(sql`
      SELECT m.org_id, org.name, sum(m.points) AS points, p.reward_text, p.enabled
      FROM loyalty_movements m JOIN organizations org ON org.id = m.org_id LEFT JOIN loyalty_programs p ON p.org_id = m.org_id
      WHERE m.user_id = ${userId}::uuid GROUP BY m.org_id, org.name, p.reward_text, p.enabled ORDER BY org.name`);
    return {
      marketingConsent: consent.rows[0]?.opted_in ?? false,
      items: rows.map((r) => ({ orgId: r.org_id, orgName: r.name, points: Number(r.points), rewardText: r.reward_text ?? '', enabled: r.enabled ?? false })),
    };
  }

  async setConsent(userId: string, optIn: boolean, meta: RequestMeta): Promise<{ marketingConsent: boolean }> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO marketing_consents (user_id, opted_in) VALUES (${userId}::uuid, ${optIn})
        ON CONFLICT (user_id) DO UPDATE SET opted_in = EXCLUDED.opted_in, updated_at = now()`);
      await appendConsent(tx, userId, 'marketing', optIn, CONSENT_VERSIONS.marketing);
      await this.audit.record({ action: 'user.marketing_consent_updated', actorUserId: userId, meta, metadata: { optIn } }, tx);
    });
    return { marketingConsent: optIn };
  }

  /** One campaign per organisation per 24 h, to the shop's opted-in customers (not blocked with the author). */
  async sendCampaign(orgId: string, actorUserId: string, req: CreateCampaignRequest, meta: RequestMeta): Promise<Campaign> {
    const { campaign, userIds } = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${orgId}`}, 0))`);
      const recent = await tx.execute(sql`SELECT 1 FROM marketing_campaigns WHERE org_id = ${orgId}::uuid AND created_at > now() - interval '24 hours' LIMIT 1`);
      if (recent.rows.length > 0) throw AppError.conflict('One campaign per 24 hours', { reason: 'campaign_rate_limited' });
      const rec = await tx.execute<{ user_id: string }>(sql`
        SELECT DISTINCT o.buyer_id AS user_id FROM orders o JOIN marketing_consents c ON c.user_id = o.buyer_id AND c.opted_in
        WHERE o.org_id = ${orgId}::uuid AND o.status <> 'cancelled' AND o.buyer_id <> ${actorUserId}::uuid
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${actorUserId}::uuid AND b.blocked_id = o.buyer_id)
                                                        OR (b.blocker_id = o.buyer_id AND b.blocked_id = ${actorUserId}::uuid))
        LIMIT ${MAX_RECIPIENTS}`);
      const ids = rec.rows.map((r) => r.user_id);
      const ins = await tx.execute<{ id: string; created_at: Date }>(sql`
        INSERT INTO marketing_campaigns (org_id, author_id, title, body, recipients)
        VALUES (${orgId}::uuid, ${actorUserId}::uuid, ${req.title}, ${req.body}, ${ids.length}) RETURNING id, created_at`);
      const row = ins.rows[0]!;
      // Audit without the text: counts only.
      await this.audit.record({ action: 'commerce.campaign_sent', actorUserId, meta, metadata: { orgId, campaignId: row.id, recipients: ids.length } }, tx);
      return { campaign: { id: row.id, title: req.title, recipients: ids.length, createdAt: new Date(row.created_at).toISOString() }, userIds: ids };
    });
    await this.notifications
      .notifyMany(userIds.map((userId) => ({ userId, category: 'commerce' as const, title: req.title, body: req.body, data: { orgId, campaignId: campaign.id } })))
      .catch((e: Error) => this.logger.warn(`campaign delivery failed: ${e.name}`));
    return campaign;
  }

  async listCampaigns(orgId: string): Promise<CampaignList> {
    const { rows } = await this.db.execute<{ id: string; title: string; recipients: number; created_at: Date }>(sql`
      SELECT id, title, recipients, created_at FROM marketing_campaigns WHERE org_id = ${orgId}::uuid ORDER BY created_at DESC LIMIT 100`);
    return { items: rows.map((r) => ({ id: r.id, title: r.title, recipients: r.recipients, createdAt: new Date(r.created_at).toISOString() })) };
  }
}
