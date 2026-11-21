import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ADS_COST_PER_CLICK_USD_MINOR,
  ADS_MAX_BUDGET_USD_MINOR,
  ADS_MIN_BUDGET_USD_MINOR,
  type AdAudience,
  type AdBilling,
  type AdCampaign,
  type AdCampaignActionRequest,
  type AdCampaignList,
  type AdCampaignListQuery,
  type AdCampaignResponse,
  type AdCampaignStats,
  type AdminCampaign,
  type AdminCampaignList,
  type AdminReviewRequest,
  type AdPlacement,
  type AdStatus,
  type CreateAdCampaignRequest,
  ErrorCodes,
  type PostList,
  type ServedAd,
  type ServedAdList,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MonetizationPayService, scaleUsd } from '../premium/pay.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import { PostsService } from '../social/posts.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../social/social.shared.js';

/** Une annonce dans le fil au plus par tranche de 10 publications (insérée après la 5e). */
export const AD_FEED_EVERY = 10;
const MAX_DAYS = 90;

type CampRow = {
  id: string;
  user_id: string;
  org_id: string | null;
  payer_org_id: string | null;
  name: string;
  objective: AdCampaign['objective'];
  post_id: string | null;
  product_id: string | null;
  country: string | null;
  city: string | null;
  min_age: number | null;
  interests: string[];
  placements: AdPlacement[];
  budget_minor: string;
  daily_budget_minor: string;
  spent_minor: string;
  refunded_minor: string;
  currency: string;
  starts_on: string;
  ends_on: string;
  status: AdStatus;
  rejection_reason: string | null;
  impressions: number;
  clicks: number;
  created_at: Date;
  ended: boolean;
  preview?: string | null;
};

const COLS = sql`c.id, c.user_id, c.org_id, c.payer_org_id, c.name, c.objective, c.post_id, c.product_id, c.country, c.city, c.min_age, c.interests, c.placements,
  c.budget_minor::text AS budget_minor, c.daily_budget_minor::text AS daily_budget_minor, c.spent_minor::text AS spent_minor, c.refunded_minor::text AS refunded_minor,
  c.currency::text AS currency, c.starts_on::text AS starts_on, c.ends_on::text AS ends_on, c.status, c.rejection_reason, c.impressions, c.clicks, c.created_at,
  (c.status IN ('approved', 'paused', 'pending') AND c.ends_on < (now() AT TIME ZONE 'UTC')::date) AS ended`;

const toCampaign = (r: CampRow): AdCampaign => ({
  id: r.id,
  name: r.name,
  objective: r.objective,
  postId: r.post_id,
  productId: r.product_id,
  orgId: r.org_id,
  audience: { country: r.country, city: r.city, minAge: r.min_age, interests: r.interests },
  placements: r.placements,
  budgetMinor: Number(r.budget_minor),
  dailyBudgetMinor: Number(r.daily_budget_minor),
  spentMinor: Number(r.spent_minor),
  refundedMinor: Number(r.refunded_minor),
  currency: r.currency.trim(),
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  status: r.ended ? 'ended' : r.status,
  rejectionReason: r.rejection_reason,
  impressions: r.impressions,
  clicks: r.clicks,
  createdAt: new Date(r.created_at).toISOString(),
});

/** Coût d'un clic selon la devise de la campagne (constantes : pas de paramètres liés dans l'expression). */
const CPC_SQL = sql.raw(`(CASE WHEN c.currency = 'CDF' THEN ${scaleUsd(ADS_COST_PER_CLICK_USD_MINOR, 'CDF')} ELSE ${ADS_COST_PER_CLICK_USD_MINOR} END)`);
const todayUtc = (): string => new Date().toISOString().slice(0, 10);
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Publicité payante (campagnes). MODE TEST : le budget est débité du portefeuille de test vers le compte `fees` à la création
 * (PIN, idempotence) ; l'argent non dépensé est remboursé à l'arrêt, au refus ou à la fin. Une campagne n'est diffusée
 * qu'après approbation de la modération. Facturation au clic (dédoublonné par spectateur et par jour), plafonnée par le budget
 * total et le budget quotidien. Les impressions sont comptées à la diffusion. Ciblage : le pays est appliqué ; la ville,
 * l'âge minimal et les centres d'intérêt sont enregistrés mais non appliqués (CASELIND ne détient pas ces données).
 * Toujours étiquetée « Sponsorisé » côté client.
 */
@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly pay: MonetizationPayService,
    private readonly ledger: LedgerService,
    private readonly posts: PostsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private cpc(currency: string): number {
    return scaleUsd(ADS_COST_PER_CLICK_USD_MINOR, currency);
  }

  // ---- création ---------------------------------------------------------------------------------

  async create(auth: AuthUser, b: CreateAdCampaignRequest, meta: RequestMeta): Promise<{ response: AdCampaignResponse; created: boolean }> {
    this.pay.assertCurrency(b.currency);
    const prior = await this.replayOf(auth.userId, b);
    if (prior) return prior;

    const min = scaleUsd(ADS_MIN_BUDGET_USD_MINOR, b.currency);
    const max = scaleUsd(ADS_MAX_BUDGET_USD_MINOR, b.currency);
    if (b.budgetMinor < min || b.budgetMinor > max) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'budgetMinor', message: `between ${min} and ${max}` }]);
    }
    if (b.dailyBudgetMinor < this.cpc(b.currency)) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'dailyBudgetMinor', message: `at least ${this.cpc(b.currency)}` }]);
    }
    const today = todayUtc();
    if (b.startsOn < today || b.endsOn > addDays(b.startsOn, MAX_DAYS)) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'startsOn', message: `not in the past, at most ${MAX_DAYS} days` }]);
    }

    let orgId: string | null = null;
    if (b.postId) {
      const found = await this.posts.requireVisible(auth.userId, auth.roles, b.postId);
      if (found.row.authorId !== auth.userId) throw AppError.forbidden('Only the author can promote this post');
      if (found.row.visibility !== 'public' || found.row.hidden) throw AppError.conflict('Only a public post can be promoted', { reason: 'ad_requires_public_post' });
      if (b.orgId) {
        await this.pay.assertOrg(auth.userId, b.orgId, true);
        orgId = b.orgId;
      }
    } else {
      const p = await this.db.execute<{ org_id: string }>(sql`SELECT org_id FROM products WHERE id = ${b.productId!}::uuid AND status = 'published' AND NOT hidden`);
      const productOrg = p.rows[0]?.org_id;
      if (!productOrg) throw AppError.notFound('Product not found');
      await this.pay.assertOrg(auth.userId, productOrg, true);
      if (b.orgId && b.orgId !== productOrg) throw AppError.forbidden('This product belongs to another organization');
      orgId = productOrg;
    }

    const id = randomUUID();
    const a = b.audience;
    try {
      const charged = await this.pay.charge(
        auth,
        { orgId, amountMinor: b.budgetMinor, currency: b.currency, clientId: b.clientId, pin: b.pin, metadata: { ref: 'ad_campaign', campaignId: id, note: 'Campagne publicitaire' } },
        meta,
        async (tx, transferId, payer) => {
          await tx.execute(sql`
            INSERT INTO ad_campaigns (id, user_id, org_id, payer_org_id, client_id, name, objective, post_id, product_id, country, city, min_age, interests, placements,
              budget_minor, daily_budget_minor, currency, starts_on, ends_on, transfer_id)
            VALUES (${id}::uuid, ${auth.userId}::uuid, ${orgId}::uuid, ${payer === 'org' ? orgId : null}::uuid, ${b.clientId}::uuid, ${b.name}, ${b.objective},
              ${b.postId ?? null}::uuid, ${b.productId ?? null}::uuid, ${a.country}, ${a.city}, ${a.minAge}, ${textArray(a.interests)}, ${textArray(b.placements)},
              ${b.budgetMinor}, ${b.dailyBudgetMinor}, ${b.currency}, ${b.startsOn}::date, ${b.endsOn}::date, ${transferId}::uuid)`);
          await this.audit.record({ action: 'ads.campaign_created', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { campaignId: id, budgetMinor: b.budgetMinor, currency: b.currency, payer } }, tx);
        },
      );
      if (charged.replayed) {
        const first = await this.replayOf(auth.userId, b);
        if (first) return first;
        throw AppError.conflict('This clientId was already used for a different payment', { reason: 'idempotency_mismatch' });
      }
    } catch (err) {
      const e = ((err as { cause?: unknown }).cause ?? err) as { code?: string };
      if (e.code === '23505') {
        const first = await this.replayOf(auth.userId, b);
        if (first) return first;
      }
      throw err;
    }
    return { created: true, response: await this.respond(auth.userId, (await this.byId(id))!, false) };
  }

  private async replayOf(userId: string, b: CreateAdCampaignRequest): Promise<{ response: AdCampaignResponse; created: boolean } | null> {
    const r = await this.db.execute<CampRow>(sql`SELECT ${COLS} FROM ad_campaigns c WHERE c.user_id = ${userId}::uuid AND c.client_id = ${b.clientId}::uuid`);
    const c = r.rows[0];
    if (!c) return null;
    if (Number(c.budget_minor) !== b.budgetMinor || c.currency.trim() !== b.currency || (c.post_id ?? null) !== (b.postId ?? null) || (c.product_id ?? null) !== (b.productId ?? null)) {
      throw AppError.conflict('This clientId was already used for a different campaign', { reason: 'idempotency_mismatch' });
    }
    return { created: false, response: await this.respond(userId, toCampaign(c), true) };
  }

  private async respond(userId: string, campaign: AdCampaign, replayed: boolean): Promise<AdCampaignResponse> {
    return { mode: 'sandbox', replayed, campaign, balanceMinor: await this.ledger.balance({ kind: 'user', userId }, campaign.currency) };
  }

  private async byId(id: string, userId?: string): Promise<AdCampaign | null> {
    const r = await this.db.execute<CampRow>(sql`SELECT ${COLS} FROM ad_campaigns c WHERE c.id = ${id}::uuid ${userId ? sql`AND c.user_id = ${userId}::uuid` : sql``}`);
    return r.rows[0] ? toCampaign(r.rows[0]) : null;
  }

  // ---- lecture / gestion par le propriétaire ------------------------------------------------------

  async listMine(userId: string, q: AdCampaignListQuery): Promise<AdCampaignList> {
    await this.settleEnded(userId);
    const c = q.cursor ? decodeCursor(q.cursor) : null;
    const r = await this.db.execute<CampRow & { ts: string }>(sql`
      SELECT ${COLS}, c.created_at::text AS ts FROM ad_campaigns c
      WHERE c.user_id = ${userId}::uuid ${q.status ? sql`AND c.status = ${q.status}` : sql``} ${c ? sql`AND (c.created_at, c.id) < (${c.ts}::timestamptz, ${c.id}::uuid)` : sql``}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ${q.limit + 1}`);
    const rows = r.rows.slice(0, q.limit);
    const last = rows.at(-1);
    return { items: rows.map(toCampaign), nextCursor: r.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  async stats(userId: string, id: string): Promise<AdCampaignStats> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Campaign not found');
    await this.settleEnded(userId);
    const campaign = await this.byId(id, userId);
    if (!campaign) throw AppError.notFound('Campaign not found');
    const d = await this.db.execute<{ day: string; impressions: number; clicks: number; spent_minor: string }>(sql`
      SELECT day::text AS day, impressions, clicks, spent_minor::text FROM ad_daily WHERE campaign_id = ${id}::uuid ORDER BY day`);
    return { campaign, days: d.rows.map((x) => ({ date: x.day, impressions: x.impressions, clicks: x.clicks, spentMinor: Number(x.spent_minor) })) };
  }

  async billing(userId: string): Promise<AdBilling> {
    const r = await this.db.execute<{ id: string; name: string; currency: string; budget_minor: string; refunded_minor: string; refunded_at: Date | null; created_at: Date }>(sql`
      SELECT id, name, currency::text AS currency, budget_minor::text, refunded_minor::text, refunded_at, created_at FROM ad_campaigns
      WHERE user_id = ${userId}::uuid ORDER BY created_at DESC LIMIT 100`);
    const items: AdBilling['items'] = [];
    for (const c of r.rows) {
      items.push({ campaignId: c.id, name: c.name, kind: 'charge', amountMinor: Number(c.budget_minor), currency: c.currency.trim(), createdAt: new Date(c.created_at).toISOString() });
      if (Number(c.refunded_minor) > 0 && c.refunded_at) {
        items.push({ campaignId: c.id, name: c.name, kind: 'refund', amountMinor: Number(c.refunded_minor), currency: c.currency.trim(), createdAt: new Date(c.refunded_at).toISOString() });
      }
    }
    items.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    return { mode: 'sandbox', items };
  }

  /** Clôture une campagne dans `tx` : statut final et remboursement du budget non dépensé (clé d'idempotence par campagne). */
  private async finish(tx: DbExecutor, c: CampRow, status: 'stopped' | 'ended' | 'rejected', extra: { reviewer?: string; reason?: string } = {}): Promise<number> {
    const remaining = Number(c.budget_minor) - Number(c.spent_minor) - Number(c.refunded_minor);
    await this.pay.refund(tx, { userId: c.user_id, orgId: c.payer_org_id }, remaining, c.currency.trim(), `ad-refund:${c.id}`, {
      ref: 'ad_refund',
      campaignId: c.id,
      note: 'Remboursement du budget publicitaire non dépensé',
    });
    await tx.execute(sql`
      UPDATE ad_campaigns SET status = ${status}, refunded_minor = refunded_minor + ${remaining}, refunded_at = CASE WHEN ${remaining} > 0 THEN now() ELSE refunded_at END,
        rejection_reason = COALESCE(${extra.reason ?? null}, rejection_reason),
        reviewed_by = COALESCE(${extra.reviewer ?? null}::uuid, reviewed_by), reviewed_at = CASE WHEN ${extra.reviewer ?? null}::uuid IS NULL THEN reviewed_at ELSE now() END
      WHERE id = ${c.id}::uuid`);
    return remaining;
  }

  private async lock(tx: DbExecutor, id: string, userId?: string): Promise<CampRow> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Campaign not found');
    const r = await tx.execute<CampRow>(sql`SELECT ${COLS} FROM ad_campaigns c WHERE c.id = ${id}::uuid ${userId ? sql`AND c.user_id = ${userId}::uuid` : sql``} FOR UPDATE`);
    if (!r.rows[0]) throw AppError.notFound('Campaign not found');
    return r.rows[0];
  }

  async act(auth: AuthUser, id: string, b: AdCampaignActionRequest, meta: RequestMeta): Promise<AdCampaign> {
    await this.db.transaction(async (tx) => {
      const c = await this.lock(tx, id, auth.userId);
      const live = c.status === 'approved' && !c.ended;
      let refunded = 0;
      if (b.action === 'pause') {
        if (!live) throw AppError.conflict('Only a running campaign can be paused', { reason: 'campaign_not_running' });
        await tx.execute(sql`UPDATE ad_campaigns SET status = 'paused' WHERE id = ${id}::uuid`);
      } else if (b.action === 'resume') {
        if (c.status !== 'paused' || c.ended) throw AppError.conflict('Only a paused campaign can be resumed', { reason: 'campaign_not_paused' });
        await tx.execute(sql`UPDATE ad_campaigns SET status = 'approved' WHERE id = ${id}::uuid`);
      } else {
        if (!['pending', 'approved', 'paused'].includes(c.status)) throw AppError.conflict('This campaign is already closed', { reason: 'campaign_closed' });
        refunded = await this.finish(tx, c, 'stopped');
      }
      await this.audit.record({ action: 'ads.campaign_changed', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { campaignId: id, action: b.action, refundedMinor: refunded } }, tx);
    });
    return (await this.byId(id, auth.userId))!;
  }

  /** Campagnes arrivées à échéance : statut `ended` et remboursement du reliquat (appelé à la lecture et toutes les heures). */
  async settleEnded(userId?: string): Promise<number> {
    const due = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM ad_campaigns WHERE status IN ('approved', 'paused', 'pending') AND ends_on < (now() AT TIME ZONE 'UTC')::date
        ${userId ? sql`AND user_id = ${userId}::uuid` : sql``} LIMIT 100`);
    let n = 0;
    for (const { id } of due.rows) {
      await this.db.transaction(async (tx) => {
        const r = await tx.execute<CampRow>(sql`SELECT ${COLS} FROM ad_campaigns c WHERE c.id = ${id}::uuid FOR UPDATE SKIP LOCKED`);
        const c = r.rows[0];
        if (!c || !['approved', 'paused', 'pending'].includes(c.status)) return;
        await this.finish(tx, c, 'ended');
        n += 1;
      });
    }
    return n;
  }

  @Interval('ads-settle', 3_600_000)
  async settleTick(): Promise<void> {
    await bestEffort(this.logger, 'ads settle', () => this.settleEnded());
  }

  // ---- diffusion ----------------------------------------------------------------------------------

  private serveWhere(viewerId: string, placement: AdPlacement) {
    return sql`
      c.status = 'approved' AND c.starts_on <= (now() AT TIME ZONE 'UTC')::date AND c.ends_on >= (now() AT TIME ZONE 'UTC')::date
      AND ${placement} = ANY(c.placements) AND c.user_id <> ${viewerId}::uuid
      AND c.spent_minor + ${CPC_SQL} <= c.budget_minor
      AND COALESCE((SELECT d.spent_minor FROM ad_daily d WHERE d.campaign_id = c.id AND d.day = (now() AT TIME ZONE 'UTC')::date), 0)
          + ${CPC_SQL} <= c.daily_budget_minor
      AND (c.country IS NULL OR c.country = (SELECT u.country FROM users u WHERE u.id = ${viewerId}::uuid))
      AND (c.post_id IS NULL OR EXISTS (SELECT 1 FROM posts p WHERE p.id = c.post_id AND p.visibility = 'public' AND NOT p.hidden AND p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = p.author_id) OR (b.blocker_id = p.author_id AND b.blocked_id = ${viewerId}::uuid))))
      AND (c.product_id IS NULL OR EXISTS (SELECT 1 FROM products pr WHERE pr.id = c.product_id AND pr.status = 'published' AND NOT pr.hidden))
      `;
  }

  private async countImpressions(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
    await this.db.execute(sql`UPDATE ad_campaigns SET impressions = impressions + 1 WHERE id IN (${list})`);
    await this.db.execute(sql`
      INSERT INTO ad_daily (campaign_id, day, impressions) SELECT id, (now() AT TIME ZONE 'UTC')::date, 1 FROM ad_campaigns WHERE id IN (${list})
      ON CONFLICT (campaign_id, day) DO UPDATE SET impressions = ad_daily.impressions + 1`);
  }

  /** Annonces à afficher à `user` à cet emplacement (approuvées, dans leurs dates, budget disponible) ; compte une impression chacune. */
  async serve(user: AuthUser, placement: AdPlacement, limit: number): Promise<ServedAdList> {
    const r = await this.db.execute<{ id: string; post_id: string | null; product_id: string | null; title: string }>(sql`
      SELECT c.id, c.post_id, c.product_id,
        COALESCE((SELECT left(coalesce(p.body, ''), 80) FROM posts p WHERE p.id = c.post_id), (SELECT pr.title FROM products pr WHERE pr.id = c.product_id), c.name) AS title
      FROM ad_campaigns c WHERE ${this.serveWhere(user.userId, placement)} ORDER BY random() LIMIT ${limit}`);
    await this.countImpressions(r.rows.map((x) => x.id));
    return { items: r.rows.map((x): ServedAd => ({ campaignId: x.id, sponsored: true, postId: x.post_id, productId: x.product_id, title: x.title || 'Sponsorisé' })) };
  }

  /** Insère les publications de campagnes (emplacement fil) après la 5e de chaque tranche de 10, hors celles déjà dans la page. */
  async injectIntoFeed(user: AuthUser, page: PostList): Promise<PostList> {
    const slots = Math.floor((page.items.length + AD_FEED_EVERY / 2) / AD_FEED_EVERY);
    if (slots === 0) return page;
    const present = page.items.map((p) => p.id);
    const r = await this.db.execute<{ id: string; post_id: string }>(sql`
      SELECT c.id, c.post_id FROM ad_campaigns c
      WHERE c.post_id IS NOT NULL AND ${this.serveWhere(user.userId, 'feed')}
        ${present.length ? sql`AND c.post_id <> ALL(ARRAY[${sql.join(present.map((i) => sql`${i}::uuid`), sql`, `)}])` : sql``}
      ORDER BY random() LIMIT ${slots}`);
    if (r.rows.length === 0) return page;
    const hydrated = (await this.posts.hydrateByIds(user.userId, user.roles, r.rows.map((x) => x.post_id))).map((p) => ({ ...p, sponsored: true }));
    if (hydrated.length === 0) return page;
    await this.countImpressions(r.rows.filter((x) => hydrated.some((h) => h.id === x.post_id)).map((x) => x.id));
    const items: PostList['items'] = [];
    let next = 0;
    page.items.forEach((p, i) => {
      items.push(p);
      if ((i + 1) % AD_FEED_EVERY === AD_FEED_EVERY / 2 && next < hydrated.length) items.push(hydrated[next++]!);
    });
    return { ...page, items };
  }

  /** Clic d'un spectateur (facturé une fois par jour et par spectateur, plafonné par les budgets) ; le propriétaire ne se facture pas. */
  async click(viewer: AuthUser, id: string): Promise<{ counted: boolean }> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Campaign not found');
    return this.db.transaction(async (tx) => {
      const r = await tx.execute<CampRow & { today_spent: string }>(sql`
        SELECT ${COLS}, COALESCE((SELECT d.spent_minor FROM ad_daily d WHERE d.campaign_id = c.id AND d.day = (now() AT TIME ZONE 'UTC')::date), 0)::text AS today_spent
        FROM ad_campaigns c WHERE c.id = ${id}::uuid FOR UPDATE`);
      const c = r.rows[0];
      if (!c || c.status !== 'approved' || c.ended || c.user_id === viewer.userId) return { counted: false };
      const seen = await tx.execute(sql`
        INSERT INTO ad_click_log (campaign_id, viewer_id, day) VALUES (${id}::uuid, ${viewer.userId}::uuid, (now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING RETURNING 1`);
      if (seen.rows.length === 0) return { counted: false };
      const cost = this.cpc(c.currency.trim());
      const spent = Number(c.spent_minor);
      if (spent + cost > Number(c.budget_minor) || Number(c.today_spent) + cost > Number(c.daily_budget_minor)) return { counted: false };
      await tx.execute(sql`UPDATE ad_campaigns SET spent_minor = spent_minor + ${cost}, clicks = clicks + 1 WHERE id = ${id}::uuid`);
      await tx.execute(sql`
        INSERT INTO ad_daily (campaign_id, day, clicks, spent_minor) VALUES (${id}::uuid, (now() AT TIME ZONE 'UTC')::date, 1, ${cost})
        ON CONFLICT (campaign_id, day) DO UPDATE SET clicks = ad_daily.clicks + 1, spent_minor = ad_daily.spent_minor + ${cost}`);
      // Budget épuisé (il ne reste pas de quoi payer un clic) : la campagne se termine et le reliquat est remboursé.
      if (Number(c.budget_minor) - spent - cost < cost) await this.finish(tx, { ...c, spent_minor: String(spent + cost) }, 'ended');
      return { counted: true };
    });
  }

  /** Clic depuis une publication sponsorisée du fil : retrouve la campagne en cours de cette publication. */
  async clickPost(viewer: AuthUser, postId: string): Promise<{ counted: boolean }> {
    if (!UUID_RE.test(postId)) return { counted: false };
    const r = await this.db.execute<{ id: string }>(sql`SELECT id FROM ad_campaigns WHERE post_id = ${postId}::uuid AND status = 'approved' AND user_id <> ${viewer.userId}::uuid ORDER BY created_at LIMIT 1`);
    return r.rows[0] ? this.click(viewer, r.rows[0].id) : { counted: false };
  }

  // ---- administration -------------------------------------------------------------------------------

  async adminList(q: AdCampaignListQuery): Promise<AdminCampaignList> {
    const c = q.cursor ? decodeCursor(q.cursor) : null;
    const r = await this.db.execute<CampRow & { ts: string; preview: string | null }>(sql`
      SELECT ${COLS}, c.created_at::text AS ts,
        COALESCE((SELECT left(coalesce(p.body, ''), 200) FROM posts p WHERE p.id = c.post_id), (SELECT pr.title FROM products pr WHERE pr.id = c.product_id)) AS preview
      FROM ad_campaigns c WHERE true ${q.status ? sql`AND c.status = ${q.status}` : sql``} ${c ? sql`AND (c.created_at, c.id) < (${c.ts}::timestamptz, ${c.id}::uuid)` : sql``}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ${q.limit + 1}`);
    const rows = r.rows.slice(0, q.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((x): AdminCampaign => ({ ...toCampaign(x), userId: x.user_id, preview: x.preview ?? null })),
      nextCursor: r.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }

  /** Revue : approuver (en attente) ou refuser avec motif (en attente ou déjà diffusée : le non-dépensé est remboursé). */
  async review(actor: AuthUser, id: string, b: AdminReviewRequest, meta: RequestMeta): Promise<AdCampaign> {
    if (b.decision === 'reject' && !b.reason) throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'reason', message: 'required to reject' }]);
    const owner = await this.db.transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (b.decision === 'approve') {
        if (c.status !== 'pending' || c.ended) throw AppError.conflict('Only a pending campaign can be approved', { reason: 'campaign_not_pending' });
        await tx.execute(sql`UPDATE ad_campaigns SET status = 'approved', reviewed_by = ${actor.userId}::uuid, reviewed_at = now(), rejection_reason = NULL WHERE id = ${id}::uuid`);
      } else {
        if (!['pending', 'approved', 'paused'].includes(c.status)) throw AppError.conflict('This campaign is already closed', { reason: 'campaign_closed' });
        await this.finish(tx, c, 'rejected', { reviewer: actor.userId, reason: b.reason });
      }
      await this.audit.record({ action: 'ads.campaign_reviewed', actorUserId: actor.userId, subjectUserId: c.user_id, sessionId: actor.sessionId, meta, metadata: { campaignId: id, decision: b.decision } }, tx);
      return c.user_id;
    });
    await bestEffort(this.logger, 'ad review notification', () =>
      this.notifications.notify({
        userId: owner,
        category: 'social',
        title: b.decision === 'approve' ? 'Campagne publicitaire approuvée' : 'Campagne publicitaire refusée (mode test)',
        body: b.decision === 'approve' ? 'Votre campagne est diffusée.' : 'Votre campagne a été refusée par la modération ; le budget non dépensé (fictif) vous a été remboursé.',
        data: { kind: 'ad_reviewed', campaignId: id },
      }),
    );
    return (await this.byId(id))!;
  }
}

const textArray = (v: readonly string[]) => (v.length ? sql`ARRAY[${sql.join(v.map((x) => sql`${x}`), sql`, `)}]::text[]` : sql`'{}'::text[]`);
