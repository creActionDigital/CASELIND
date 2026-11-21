import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  type AdminSubscription,
  type AdminSubscriptionList,
  type AdminSubscriptionsQuery,
  type AutoRenewRequest,
  type PutPlanRequest,
  type RenewRequest,
  type Subscription,
  type SubscribeRequest,
  type SubscriptionPayment,
  type SubscriptionPaymentList,
  type SubscriptionPlan,
  type SubscriptionPlanList,
  type SubscriptionResponse,
  type SubscriptionState,
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
import type { AuthUser } from '../security/auth.guard.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../social/social.shared.js';
import { MonetizationPayService } from './pay.service.js';

type PlanRow = { code: string; audience: 'user' | 'org'; period: 'month' | 'year'; price_usd_minor: string; price_cdf_minor: string; active: boolean };
type SubRow = {
  id: string;
  user_id: string;
  org_id: string | null;
  plan_code: string;
  currency: string;
  price_minor: string;
  auto_renew: boolean;
  started_at: Date;
  current_period_end: Date;
  cancelled_at: Date | null;
  expired: boolean;
};
type PayRow = { id: string; receipt_no: string; plan_code: string; kind: 'initial' | 'renewal'; amount_minor: string; currency: string; payer: 'user' | 'org'; created_at: Date };

const toPlan = (r: PlanRow): SubscriptionPlan => ({
  code: r.code,
  audience: r.audience,
  period: r.period,
  priceUsdMinor: Number(r.price_usd_minor),
  priceCdfMinor: Number(r.price_cdf_minor),
  active: r.active,
});
const toSub = (r: SubRow): Subscription => ({
  id: r.id,
  planCode: r.plan_code,
  orgId: r.org_id,
  currency: r.currency.trim(),
  priceMinor: Number(r.price_minor),
  status: r.expired ? 'expired' : 'active',
  autoRenew: r.auto_renew && !r.expired,
  startedAt: new Date(r.started_at).toISOString(),
  currentPeriodEnd: new Date(r.current_period_end).toISOString(),
  cancelledAt: r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null,
});
const toPay = (r: PayRow): SubscriptionPayment => ({
  id: r.id,
  receiptNo: r.receipt_no,
  planCode: r.plan_code,
  kind: r.kind,
  amountMinor: Number(r.amount_minor),
  currency: r.currency.trim(),
  payer: r.payer,
  createdAt: new Date(r.created_at).toISOString(),
});

const SUB_COLS = sql`id, user_id, org_id, plan_code, currency::text AS currency, price_minor::text AS price_minor, auto_renew, started_at,
  current_period_end, cancelled_at, (current_period_end <= now()) AS expired`;
const intervalOf = (period: string) => (period === 'year' ? sql`interval '1 year'` : sql`interval '1 month'`);
const priceOf = (p: PlanRow, currency: string): number => Number(currency === 'CDF' ? p.price_cdf_minor : p.price_usd_minor);
const receiptNo = (): string => `CSL-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * Abonnements Premium (utilisateur) et forfaits pros (organisation), payés en MODE TEST par le portefeuille de test. Un abonnement
 * par utilisateur et par organisation (ligne réutilisée). Résilier coupe le renouvellement ; l'accès va jusqu'à la fin de la période payée.
 * Seul avantage : le badge Premium (aucun avantage caché). Le renouvellement automatique débite sans PIN (consentement donné à la
 * souscription) et se désactive de lui-même si le solde manque.
 */
@Injectable()
export class PremiumService {
  private readonly logger = new Logger(PremiumService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly pay: MonetizationPayService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async plans(includeInactive = false): Promise<SubscriptionPlanList> {
    const r = await this.db.execute<PlanRow>(sql`
      SELECT code, audience, period, price_usd_minor::text, price_cdf_minor::text, active FROM subscription_plans
      ${includeInactive ? sql`` : sql`WHERE active`} ORDER BY audience DESC, period DESC`);
    return { items: r.rows.map(toPlan) };
  }

  async putPlan(actor: AuthUser, code: string, b: PutPlanRequest, meta: RequestMeta): Promise<SubscriptionPlan> {
    const r = await this.db.execute<PlanRow>(sql`
      UPDATE subscription_plans SET price_usd_minor = ${b.priceUsdMinor}, price_cdf_minor = ${b.priceCdfMinor}, active = ${b.active}, updated_at = now()
      WHERE code = ${code} RETURNING code, audience, period, price_usd_minor::text, price_cdf_minor::text, active`);
    if (!r.rows[0]) throw AppError.notFound('Plan not found');
    await this.audit.record({ action: 'premium.plan_updated', actorUserId: actor.userId, sessionId: actor.sessionId, meta, metadata: { planCode: code, priceUsdMinor: b.priceUsdMinor, priceCdfMinor: b.priceCdfMinor, active: b.active } });
    return toPlan(r.rows[0]);
  }

  private async scopeRow(ex: DbExecutor, userId: string, orgId: string | undefined, lock = false): Promise<SubRow | null> {
    const r = await ex.execute<SubRow>(sql`
      SELECT ${SUB_COLS} FROM subscriptions WHERE ${orgId ? sql`org_id = ${orgId}::uuid` : sql`user_id = ${userId}::uuid AND org_id IS NULL`} ${lock ? sql`FOR UPDATE` : sql``}`);
    return r.rows[0] ?? null;
  }

  async state(userId: string, orgId?: string): Promise<SubscriptionState> {
    if (orgId) await this.pay.assertOrg(userId, orgId, false);
    const row = await this.scopeRow(this.db, userId, orgId);
    return { mode: 'sandbox', subscription: row ? toSub(row) : null, premium: !!row && !row.expired };
  }

  /** Badge public : seul « premium ou non » est visible, jamais le plan ni les dates. */
  async isPremium(userId: string): Promise<boolean> {
    if (!UUID_RE.test(userId)) return false;
    const r = await this.db.execute(sql`SELECT 1 FROM subscriptions WHERE user_id = ${userId}::uuid AND org_id IS NULL AND current_period_end > now()`);
    return r.rows.length > 0;
  }

  async payments(userId: string, limit: number, cursor?: string): Promise<SubscriptionPaymentList> {
    const c = cursor ? decodeCursor(cursor) : null;
    const r = await this.db.execute<PayRow & { ts: string }>(sql`
      SELECT id, receipt_no, plan_code, kind, amount_minor::text, currency::text AS currency, payer, created_at, created_at::text AS ts
      FROM subscription_payments WHERE user_id = ${userId}::uuid ${c ? sql`AND (created_at, id) < (${c.ts}::timestamptz, ${c.id}::uuid)` : sql``}
      ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`);
    const rows = r.rows.slice(0, limit);
    const last = rows.at(-1);
    return { items: rows.map(toPay), nextCursor: r.rows.length > limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  private async plan(code: string, audience: 'user' | 'org', mustBeActive = true): Promise<PlanRow> {
    const r = await this.db.execute<PlanRow>(sql`SELECT code, audience, period, price_usd_minor::text, price_cdf_minor::text, active FROM subscription_plans WHERE code = ${code}`);
    const p = r.rows[0];
    if (!p || p.audience !== audience || (mustBeActive && !p.active)) throw AppError.notFound('Plan not found');
    return p;
  }

  private async replayOf(userId: string, clientId: string, planCode: string, amountMinor: number, currency: string): Promise<SubscriptionResponse | null> {
    const r = await this.db.execute<PayRow & { subscription_id: string }>(sql`
      SELECT id, receipt_no, plan_code, kind, amount_minor::text, currency::text AS currency, payer, created_at, subscription_id
      FROM subscription_payments WHERE user_id = ${userId}::uuid AND client_id = ${clientId}::uuid`);
    const p = r.rows[0];
    if (!p) return null;
    if (p.plan_code !== planCode || Number(p.amount_minor) !== amountMinor || p.currency.trim() !== currency) {
      throw AppError.conflict('This clientId was already used for a different payment', { reason: 'idempotency_mismatch' });
    }
    return this.respond(userId, p.subscription_id, toPay(p), true);
  }

  private async respond(userId: string, subscriptionId: string, payment: SubscriptionPayment, replayed: boolean): Promise<SubscriptionResponse> {
    const r = await this.db.execute<SubRow>(sql`SELECT ${SUB_COLS} FROM subscriptions WHERE id = ${subscriptionId}::uuid`);
    return {
      mode: 'sandbox',
      replayed,
      subscription: toSub(r.rows[0]!),
      payment,
      balanceMinor: await this.ledger.balance({ kind: 'user', userId }, payment.currency),
    };
  }

  /** Les deux requêtes concurrentes qui créent la même ligne : l'index unique en laisse passer une, l'autre se replie en conflit. */
  private conflictOf(err: unknown): never {
    const e = ((err as { cause?: unknown }).cause ?? err) as { code?: string };
    if (e.code === '23505') throw AppError.conflict('Already subscribed', { reason: 'already_subscribed' });
    throw err;
  }

  async subscribe(auth: AuthUser, b: SubscribeRequest, meta: RequestMeta): Promise<{ response: SubscriptionResponse; created: boolean }> {
    this.pay.assertCurrency(b.currency);
    if (b.orgId) await this.pay.assertOrg(auth.userId, b.orgId, true);
    const plan = await this.plan(b.planCode, b.orgId ? 'org' : 'user');
    const price = priceOf(plan, b.currency);
    const prior = await this.replayOf(auth.userId, b.clientId, plan.code, price, b.currency);
    if (prior) return { response: prior, created: false };
    const cur = await this.scopeRow(this.db, auth.userId, b.orgId);
    if (cur && !cur.expired) throw AppError.conflict('Already subscribed', { reason: 'already_subscribed' });

    let subId = '';
    let payment!: SubscriptionPayment;
    try {
      const charged = await this.pay.charge(
        auth,
        { orgId: b.orgId, amountMinor: price, currency: b.currency, clientId: b.clientId, pin: b.pin, metadata: { ref: 'subscription', planCode: plan.code, note: 'Abonnement' } },
        meta,
        async (tx, transferId, payer) => {
          const locked = await this.scopeRow(tx, auth.userId, b.orgId, true);
          if (locked && !locked.expired) throw AppError.conflict('Already subscribed', { reason: 'already_subscribed' });
          const upsert = b.orgId
            ? sql`ON CONFLICT (org_id) WHERE org_id IS NOT NULL DO UPDATE`
            : sql`ON CONFLICT (user_id) WHERE org_id IS NULL DO UPDATE`;
          const s = await tx.execute<{ id: string }>(sql`
            INSERT INTO subscriptions (user_id, org_id, plan_code, currency, price_minor, auto_renew, current_period_end)
            VALUES (${auth.userId}::uuid, ${b.orgId ?? null}::uuid, ${plan.code}, ${b.currency}, ${price}, ${b.autoRenew}, now() + ${intervalOf(plan.period)})
            ${upsert} SET plan_code = EXCLUDED.plan_code, currency = EXCLUDED.currency, price_minor = EXCLUDED.price_minor, auto_renew = EXCLUDED.auto_renew,
              started_at = now(), current_period_end = EXCLUDED.current_period_end, cancelled_at = NULL
            RETURNING id`);
          subId = s.rows[0]!.id;
          const p = await tx.execute<PayRow>(sql`
            INSERT INTO subscription_payments (subscription_id, user_id, org_id, plan_code, kind, amount_minor, currency, payer, transfer_id, client_id, receipt_no)
            VALUES (${subId}::uuid, ${auth.userId}::uuid, ${b.orgId ?? null}::uuid, ${plan.code}, 'initial', ${price}, ${b.currency}, ${payer}, ${transferId}::uuid, ${b.clientId}::uuid, ${receiptNo()})
            RETURNING id, receipt_no, plan_code, kind, amount_minor::text, currency::text AS currency, payer, created_at`);
          payment = toPay(p.rows[0]!);
          await this.audit.record({ action: 'premium.subscribed', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { subscriptionId: subId, planCode: plan.code, amountMinor: price, currency: b.currency, orgId: b.orgId ?? null } }, tx);
        },
      );
      if (charged.replayed) {
        const first = await this.replayOf(auth.userId, b.clientId, plan.code, price, b.currency);
        if (first) return { response: first, created: false };
        throw AppError.conflict('This clientId was already used for a different payment', { reason: 'idempotency_mismatch' });
      }
    } catch (err) {
      this.conflictOf(err);
    }
    return { response: await this.respond(auth.userId, subId, payment, false), created: true };
  }

  async renew(auth: AuthUser, b: RenewRequest, meta: RequestMeta): Promise<{ response: SubscriptionResponse; created: boolean }> {
    if (b.orgId) await this.pay.assertOrg(auth.userId, b.orgId, true);
    const cur = await this.scopeRow(this.db, auth.userId, b.orgId);
    if (!cur) throw AppError.notFound('No subscription');
    const currency = cur.currency.trim();
    const plan = await this.plan(cur.plan_code, b.orgId ? 'org' : 'user');
    const price = priceOf(plan, currency);
    const prior = await this.replayOf(auth.userId, b.clientId, plan.code, price, currency);
    if (prior) return { response: prior, created: false };
    let payment!: SubscriptionPayment;
    const charged = await this.pay.charge(
      auth,
      { orgId: b.orgId, amountMinor: price, currency, clientId: b.clientId, pin: b.pin, metadata: { ref: 'subscription', planCode: plan.code, note: 'Renouvellement' } },
      meta,
      async (tx, transferId, payer) => {
        const locked = await this.scopeRow(tx, auth.userId, b.orgId, true);
        if (!locked) throw AppError.notFound('No subscription');
        // Prolonge depuis la fin de la période en cours (rien n'est perdu si l'on renouvelle en avance).
        await tx.execute(sql`
          UPDATE subscriptions SET price_minor = ${price}, current_period_end = greatest(current_period_end, now()) + ${intervalOf(plan.period)}
          WHERE id = ${locked.id}::uuid`);
        const p = await tx.execute<PayRow>(sql`
          INSERT INTO subscription_payments (subscription_id, user_id, org_id, plan_code, kind, amount_minor, currency, payer, transfer_id, client_id, receipt_no)
          VALUES (${locked.id}::uuid, ${auth.userId}::uuid, ${b.orgId ?? null}::uuid, ${plan.code}, 'renewal', ${price}, ${currency}, ${payer}, ${transferId}::uuid, ${b.clientId}::uuid, ${receiptNo()})
          RETURNING id, receipt_no, plan_code, kind, amount_minor::text, currency::text AS currency, payer, created_at`);
        payment = toPay(p.rows[0]!);
        await this.audit.record({ action: 'premium.renewed', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { subscriptionId: locked.id, planCode: plan.code, amountMinor: price, currency } }, tx);
      },
    );
    if (charged.replayed) {
      const first = await this.replayOf(auth.userId, b.clientId, plan.code, price, currency);
      if (first) return { response: first, created: false };
      throw AppError.conflict('This clientId was already used for a different payment', { reason: 'idempotency_mismatch' });
    }
    return { response: await this.respond(auth.userId, cur.id, payment, false), created: true };
  }

  /** Résilier = arrêter le renouvellement automatique ; l'accès reste jusqu'à la fin de la période payée. */
  async cancel(auth: AuthUser, orgId: string | undefined, meta: RequestMeta): Promise<SubscriptionState> {
    if (orgId) await this.pay.assertOrg(auth.userId, orgId, true);
    const cur = await this.scopeRow(this.db, auth.userId, orgId);
    if (!cur || cur.expired) throw AppError.conflict('No active subscription', { reason: 'no_active_subscription' });
    await this.db.execute(sql`UPDATE subscriptions SET auto_renew = false, cancelled_at = COALESCE(cancelled_at, now()) WHERE id = ${cur.id}::uuid`);
    await this.audit.record({ action: 'premium.cancelled', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { subscriptionId: cur.id, planCode: cur.plan_code } });
    return this.state(auth.userId, orgId);
  }

  async setAutoRenew(auth: AuthUser, b: AutoRenewRequest): Promise<SubscriptionState> {
    if (b.orgId) await this.pay.assertOrg(auth.userId, b.orgId, true);
    const cur = await this.scopeRow(this.db, auth.userId, b.orgId);
    if (!cur || cur.expired) throw AppError.conflict('No active subscription', { reason: 'no_active_subscription' });
    await this.db.execute(sql`
      UPDATE subscriptions SET auto_renew = ${b.autoRenew}, cancelled_at = ${b.autoRenew ? sql`NULL` : sql`COALESCE(cancelled_at, now())`} WHERE id = ${cur.id}::uuid`);
    return this.state(auth.userId, b.orgId);
  }

  // ---- renouvellement automatique -------------------------------------------------------------

  @Interval('premium-renew', 3_600_000)
  async renewTick(): Promise<void> {
    await bestEffort(this.logger, 'premium auto-renew', () => this.renewDue());
  }

  /**
   * Renouvelle les abonnements échus dont le renouvellement automatique est actif (débit sans PIN : consentement à la
   * souscription). Solde insuffisant : le renouvellement automatique est désactivé et l'abonné prévenu.
   */
  async renewDue(): Promise<number> {
    const due = await this.db.execute<{ id: string }>(sql`SELECT id FROM subscriptions WHERE auto_renew AND current_period_end <= now() ORDER BY current_period_end LIMIT 100`);
    let renewed = 0;
    for (const { id } of due.rows) {
      const outcome = await this.db.transaction(async (tx) => {
        const r = await tx.execute<SubRow>(sql`SELECT ${SUB_COLS} FROM subscriptions WHERE id = ${id}::uuid AND auto_renew AND current_period_end <= now() FOR UPDATE SKIP LOCKED`);
        const s = r.rows[0];
        if (!s) return 'skip' as const;
        const currency = s.currency.trim();
        const plan = await tx.execute<PlanRow>(sql`SELECT code, audience, period, price_usd_minor::text, price_cdf_minor::text, active FROM subscription_plans WHERE code = ${s.plan_code}`);
        const p = plan.rows[0];
        const price = p ? priceOf(p, currency) : 0;
        const ok = p?.active
          ? await this.chargeRenewal(tx, s, price, currency)
          : false;
        if (!ok) {
          await tx.execute(sql`UPDATE subscriptions SET auto_renew = false WHERE id = ${id}::uuid`);
          return { failed: s.user_id } as const;
        }
        await tx.execute(sql`UPDATE subscriptions SET price_minor = ${price}, current_period_end = current_period_end + ${intervalOf(p!.period)} WHERE id = ${id}::uuid`);
        return 'ok' as const;
      });
      if (outcome === 'ok') renewed += 1;
      else if (outcome !== 'skip') {
        await bestEffort(this.logger, 'premium renewal failure notification', () =>
          this.notifications.notify({
            userId: outcome.failed,
            category: 'payment',
            title: 'Renouvellement impossible (mode test)',
            body: 'Le solde de votre portefeuille de test ne couvre pas le renouvellement : le renouvellement automatique est désactivé.',
            data: { kind: 'subscription_renewal_failed' },
          }),
        );
      }
    }
    return renewed;
  }

  private async chargeRenewal(tx: DbExecutor, s: SubRow, price: number, currency: string): Promise<boolean> {
    const useOrg = !!s.org_id && (await this.ledger.balance({ kind: 'org', orgId: s.org_id }, currency)) >= price;
    const key = `sub-renew:${s.id}:${new Date(s.current_period_end).getTime()}`;
    const res = await this.ledger.transfer(
      {
        from: useOrg ? { kind: 'org', orgId: s.org_id! } : { kind: 'user', userId: s.user_id },
        to: { kind: 'system', code: 'fees' },
        amountMinor: price,
        currency,
        kind: 'p2p',
        idempotencyKey: key,
        initiatedBy: null,
        metadata: { ref: 'subscription', planCode: s.plan_code, note: 'Renouvellement automatique' },
      },
      tx,
    );
    if (!res.ok) return false;
    await tx.execute(sql`
      INSERT INTO subscription_payments (subscription_id, user_id, org_id, plan_code, kind, amount_minor, currency, payer, transfer_id, receipt_no)
      VALUES (${s.id}::uuid, ${s.user_id}::uuid, ${s.org_id}::uuid, ${s.plan_code}, 'renewal', ${price}, ${currency}, ${useOrg ? 'org' : 'user'}, ${res.transferId}::uuid, ${receiptNo()})`);
    return true;
  }

  // ---- admin --------------------------------------------------------------------------------

  async adminList(q: AdminSubscriptionsQuery): Promise<AdminSubscriptionList> {
    const c = q.cursor ? decodeCursor(q.cursor) : null;
    const r = await this.db.execute<SubRow & { ts: string }>(sql`
      SELECT ${SUB_COLS}, created_at::text AS ts FROM subscriptions
      WHERE true ${q.status ? sql`AND (current_period_end <= now()) = ${q.status === 'expired'}` : sql``}
        ${c ? sql`AND (created_at, id) < (${c.ts}::timestamptz, ${c.id}::uuid)` : sql``}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`);
    const rows = r.rows.slice(0, q.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((x): AdminSubscription => ({ ...toSub(x), userId: x.user_id })),
      nextCursor: r.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }

  /** Annulation par l'administration : fin immédiate, sans renouvellement (aucun remboursement automatique). */
  async adminCancel(actor: AuthUser, id: string, meta: RequestMeta): Promise<AdminSubscription> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Subscription not found');
    const r = await this.db.execute<SubRow>(sql`
      UPDATE subscriptions SET auto_renew = false, cancelled_at = COALESCE(cancelled_at, now()), current_period_end = least(current_period_end, now())
      WHERE id = ${id}::uuid AND current_period_end > now() RETURNING ${SUB_COLS}`);
    const row = r.rows[0];
    if (!row) throw AppError.conflict('Only a running subscription can be cancelled', { reason: 'subscription_not_active' });
    await this.audit.record({ action: 'premium.admin_cancelled', actorUserId: actor.userId, subjectUserId: row.user_id, sessionId: actor.sessionId, meta, metadata: { subscriptionId: id, planCode: row.plan_code } });
    await bestEffort(this.logger, 'subscription cancel notification', () =>
      this.notifications.notify({
        userId: row.user_id,
        category: 'payment',
        title: 'Abonnement annulé',
        body: 'Votre abonnement a été annulé par l’équipe CASELIND.',
        data: { kind: 'subscription_cancelled' },
      }),
    );
    return { ...toSub({ ...row, expired: true }), userId: row.user_id };
  }
}
