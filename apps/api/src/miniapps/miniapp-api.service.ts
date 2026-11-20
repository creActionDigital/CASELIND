import { Inject, Injectable } from '@nestjs/common';
import {
  type ConfirmMiniAppPaymentRequest,
  type CreateMiniAppPaymentRequest,
  ErrorCodes,
  type MiniAppMe,
  type MiniAppOrderList,
  type MiniAppPageQuery,
  type MiniAppPaymentRequest,
  type MiniAppNotifyRequest,
  type MiniAppNotifyResponse,
  type MiniAppPaymentRequestList,
  MINIAPP_NOTIFY_PER_DAY,
  readManifest,
  undeclaredLinks,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { PinService } from '../kyc/pin.service.js';
import { MiniAppUsageService } from './miniapp-usage.service.js';
import { MiniAppWebhookService } from './miniapp-webhook.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { decodeCursor, encodeCursor, validationError } from '../social/social.shared.js';
import { LedgerPort, type TransferInput } from '../wallet/ledger.port.js';
import { pinRefusal } from '../wallet/pin.port.js';
import type { MiniAppPrincipal } from './miniapp-token.guard.js';
import { appSubject, iso, PAYMENT_REQUEST_TTL_MS } from './miniapps.shared.js';

type PaymentRow = {
  id: string;
  app_id: string;
  app_name: string;
  org_id: string;
  user_id: string;
  client_ref: string;
  amount_minor: string | number;
  currency: string;
  description: string | null;
  status: MiniAppPaymentRequest['status'];
  expires_at: string | Date;
  transfer_id: string | null;
  created_at: string | Date;
};

const PAYMENT_SELECT = sql.raw(
  `r.id, r.app_id, a.name AS app_name, r.org_id, r.user_id, r.client_ref, r.amount_minor, r.currency, r.description, r.status, r.expires_at, r.transfer_id, r.created_at`,
);

function toPayment(r: PaymentRow, now = new Date()): MiniAppPaymentRequest {
  // A pending request past its deadline reads as expired even before anything wrote that down.
  const status = r.status === 'pending' && new Date(r.expires_at) <= now ? 'expired' : r.status;
  return {
    id: r.id,
    appId: r.app_id,
    appName: r.app_name,
    clientRef: r.client_ref,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    description: r.description,
    status,
    expiresAt: iso(r.expires_at),
    transferId: r.transfer_id,
    createdAt: iso(r.created_at),
  };
}

/** What an app can do with its token (miniapp-api) and the user's side of its payment requests. */
@Injectable()
export class MiniAppApiService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly pins: PinService,
    private readonly ledger: LedgerPort,
    private readonly notifications: NotificationsService,
    private readonly usage: MiniAppUsageService,
    private readonly hooks: MiniAppWebhookService,
  ) {}

  // ---- with an app token ---------------------------------------------------------------------------

  async me(p: MiniAppPrincipal): Promise<MiniAppMe> {
    const res = await this.db.execute<{ id: string; display_name: string; handle: string; avatar_url: string | null; phone: string | null; email: string | null; phone_verified_at: unknown; email_verified_at: unknown }>(sql`
      SELECT id, display_name, handle::text AS handle, avatar_url, phone, email::text AS email, phone_verified_at, email_verified_at FROM users WHERE id = ${p.userId}::uuid`);
    const u = res.rows[0];
    if (!u) throw AppError.notFound('User not found');
    const out: MiniAppMe = { id: appSubject(this.env, p.appId, u.id), displayName: u.display_name, handle: u.handle, avatarUrl: u.avatar_url };
    // Only what the user agreed to share, and only verified identifiers.
    if (p.scopes.includes('profile.phone')) out.phone = u.phone_verified_at ? u.phone : null;
    if (p.scopes.includes('profile.email')) out.email = u.email_verified_at ? u.email : null;
    return out;
  }

  /** Orders the user placed with the organisation that owns the app, nothing else. */
  async orders(p: MiniAppPrincipal, q: MiniAppPageQuery): Promise<MiniAppOrderList> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const res = await this.db.execute<{ id: string; number: string; status: string; currency: string; total_minor: string | number; ts: string; created_at: string | Date }>(sql`
      SELECT id, number, status, currency, total_minor, created_at, created_at::text AS ts FROM orders
      WHERE buyer_id = ${p.userId}::uuid AND org_id = ${p.orgId}::uuid
        ${cursor ? sql`AND (created_at, id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        currency: o.currency,
        totalMinor: Number(o.total_minor),
        createdAt: iso(o.created_at),
      })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    };
  }

  /** Opens a sandbox payment request. It moves no money: only the user's PIN confirmation does. */
  async createPaymentRequest(p: MiniAppPrincipal, body: CreateMiniAppPaymentRequest): Promise<{ request: MiniAppPaymentRequest; created: boolean }> {
    if (!this.env.COMMERCE_CURRENCIES.includes(body.currency)) throw validationError('currency', 'currency not supported');
    const ins = await this.db.execute<{ id: string }>(sql`
      INSERT INTO miniapp_payment_requests (app_id, org_id, user_id, client_ref, amount_minor, currency, description, expires_at)
      VALUES (${p.appId}::uuid, ${p.orgId}::uuid, ${p.userId}::uuid, ${body.clientRef}, ${body.amountMinor}, ${body.currency}, ${body.description ?? null},
              ${new Date(Date.now() + PAYMENT_REQUEST_TTL_MS)})
      ON CONFLICT (app_id, client_ref) DO NOTHING RETURNING id`);
    const created = ins.rows.length > 0;
    const res = await this.db.execute<PaymentRow>(sql`
      SELECT ${PAYMENT_SELECT} FROM miniapp_payment_requests r JOIN miniapps a ON a.id = r.app_id
      WHERE r.app_id = ${p.appId}::uuid AND r.client_ref = ${body.clientRef}`);
    const row = res.rows[0]!;
    if (!created && (row.user_id !== p.userId || Number(row.amount_minor) !== body.amountMinor || row.currency !== body.currency)) {
      throw AppError.conflict('clientRef already used for a different request', { reason: 'client_ref_reused' });
    }
    if (created) {
      await this.usage.bumpQuietly(p.appId, 'payment_requests');
      await this.notifications.notifyMany([
        {
          userId: p.userId,
          category: 'payment' as const,
          title: 'Demande de paiement',
          body: `${row.app_name} demande ${(body.amountMinor / 100).toFixed(2)} ${body.currency} (sandbox). Confirmez avec votre PIN.`,
          data: { kind: 'miniapp_payment_request', requestId: row.id, appId: p.appId },
        },
      ]);
    }
    return { request: toPayment(row), created };
  }

  async getPaymentRequestForApp(p: MiniAppPrincipal, id: string): Promise<MiniAppPaymentRequest> {
    const res = await this.db.execute<PaymentRow>(sql`
      SELECT ${PAYMENT_SELECT} FROM miniapp_payment_requests r JOIN miniapps a ON a.id = r.app_id
      WHERE r.id = ${id}::uuid AND r.app_id = ${p.appId}::uuid AND r.user_id = ${p.userId}::uuid`);
    if (!res.rows[0]) throw AppError.notFound('Payment request not found');
    return toPayment(res.rows[0]);
  }

  /**
   * Scope `notify`: one notification to the user of the token, labelled with the app name. Never to anyone else, 5 a day per
   * (app, user), a global daily cap per app, no link outside the hosts the app declared, silent when the user muted the app.
   */
  async notify(p: MiniAppPrincipal, body: MiniAppNotifyRequest): Promise<MiniAppNotifyResponse> {
    const res = await this.db.execute<{ name: string; launch_url: string; redirect_uris: string[]; manifest: unknown; muted: boolean }>(sql`
      SELECT a.name, a.launch_url, a.redirect_uris, a.manifest, g.notifications_muted AS muted
      FROM miniapps a JOIN miniapp_grants g ON g.app_id = a.id AND g.user_id = ${p.userId}::uuid AND g.revoked_at IS NULL
      WHERE a.id = ${p.appId}::uuid`);
    const app = res.rows[0];
    if (!app) throw AppError.notFound('Application not found');
    const manifest = readManifest(app.manifest);
    const hostOf = (u: string): string => new URL(u).hostname.toLowerCase();
    const allowed = [app.launch_url, ...app.redirect_uris, manifest?.termsUrl, manifest?.privacyUrl].filter((u): u is string => !!u).map(hostOf);
    if (undeclaredLinks(`${body.title} ${body.body}`, allowed).length > 0) throw validationError('body', 'links to hosts the application did not declare are not allowed');
    if (body.deepLink && hostOf(body.deepLink) !== hostOf(app.launch_url)) throw validationError('deepLink', 'must point to the application launch host');
    if (app.muted) return { delivered: false, remainingToday: 0 };

    const cap = await this.db.execute<{ n: string | number }>(sql`SELECT coalesce(sum(n), 0) AS n FROM miniapp_notify_daily WHERE miniapp_id = ${p.appId}::uuid AND day = (now() AT TIME ZONE 'UTC')::date`);
    if (Number(cap.rows[0]?.n ?? 0) >= this.env.MINIAPP_NOTIFY_APP_PER_DAY) throw new AppError(429, ErrorCodes.rateLimited, 'Application notification quota reached for today', { reason: 'notify_quota', scope: 'app' });
    const hit = await this.db.execute<{ n: number }>(sql`
      INSERT INTO miniapp_notify_daily (miniapp_id, user_id, day, n) VALUES (${p.appId}::uuid, ${p.userId}::uuid, (now() AT TIME ZONE 'UTC')::date, 1)
      ON CONFLICT (miniapp_id, user_id, day) DO UPDATE SET n = miniapp_notify_daily.n + 1 WHERE miniapp_notify_daily.n < ${MINIAPP_NOTIFY_PER_DAY}
      RETURNING n`);
    if (hit.rows.length === 0) throw new AppError(429, ErrorCodes.rateLimited, 'Daily notification limit reached for this user', { reason: 'notify_quota', scope: 'user', limit: MINIAPP_NOTIFY_PER_DAY });
    await this.notifications.notifyMany([
      {
        userId: p.userId,
        category: 'system' as const,
        title: `[${app.name}] : ${body.title}`,
        body: body.body,
        data: { kind: 'miniapp_notify', appId: p.appId, ...(body.deepLink ? { deepLink: body.deepLink } : {}) },
      },
    ]);
    // Audit holds the app and the user, never the text.
    await this.audit.record({ action: 'miniapp.notified', actorUserId: p.userId, metadata: { appId: p.appId } });
    return { delivered: true, remainingToday: MINIAPP_NOTIFY_PER_DAY - hit.rows[0]!.n };
  }

  // ---- the user's side -----------------------------------------------------------------------------

  /** Requests waiting for the user's decision. */
  async listPendingForUser(userId: string): Promise<MiniAppPaymentRequestList> {
    const res = await this.db.execute<PaymentRow>(sql`
      SELECT ${PAYMENT_SELECT} FROM miniapp_payment_requests r JOIN miniapps a ON a.id = r.app_id
      WHERE r.user_id = ${userId}::uuid AND r.status = 'pending' AND r.expires_at > now() ORDER BY r.created_at DESC, r.id DESC LIMIT 50`);
    return { items: res.rows.map((r) => toPayment(r)) };
  }

  private async loadOwn(userId: string, id: string, lock = false, tx: Pick<Db, 'execute'> = this.db): Promise<PaymentRow> {
    const res = await tx.execute<PaymentRow>(sql`
      SELECT ${PAYMENT_SELECT} FROM miniapp_payment_requests r JOIN miniapps a ON a.id = r.app_id
      WHERE r.id = ${id}::uuid AND r.user_id = ${userId}::uuid ${lock ? sql`FOR UPDATE OF r` : sql``}`);
    if (!res.rows[0]) throw AppError.notFound('Payment request not found');
    return res.rows[0];
  }

  async decline(userId: string, id: string): Promise<MiniAppPaymentRequest> {
    const row = await this.loadOwn(userId, id);
    if (row.status === 'declined') return toPayment(row);
    const upd = await this.db.execute(sql`
      UPDATE miniapp_payment_requests SET status = 'declined', decided_at = now() WHERE id = ${id}::uuid AND status = 'pending' RETURNING id`);
    if (upd.rows.length > 0) {
      this.hooks.emit(row.app_id, userId, 'payment.declined', { paymentRequestId: id, clientRef: row.client_ref, amountMinor: Number(row.amount_minor), currency: row.currency });
    }
    return toPayment(await this.loadOwn(userId, id));
  }

  /**
   * The only way money moves for an app: the signed-in user types their PIN in CASELIND. The request must still be
   * pending and unexpired, the app published and the wallet.pay grant alive.
   */
  async confirm(userId: string, id: string, body: ConfirmMiniAppPaymentRequest, meta: RequestMeta): Promise<MiniAppPaymentRequest> {
    const pre = await this.loadOwn(userId, id);
    if (pre.status === 'paid') return toPayment(pre);
    if (pre.status !== 'pending') throw AppError.conflict('This payment request can no longer be confirmed', { reason: 'request_closed', status: pre.status });
    if (new Date(pre.expires_at) <= new Date()) throw AppError.conflict('This payment request has expired', { reason: 'request_expired' });

    const live = await this.db.execute<{ id: string }>(sql`
      SELECT a.id FROM miniapps a JOIN organizations o ON o.id = a.org_id JOIN miniapp_grants g ON g.app_id = a.id
      WHERE a.id = ${pre.app_id}::uuid AND a.status = 'published' AND o.status = 'active'
        AND g.user_id = ${userId}::uuid AND g.revoked_at IS NULL AND 'wallet.pay' = ANY(g.scopes)`);
    if (live.rows.length === 0) throw AppError.conflict('The application is no longer authorized to request payments', { reason: 'app_unavailable' });

    const refusal = pinRefusal(await this.pins.verify(userId, body.pin));
    if (refusal) throw refusal;

    const input: TransferInput = {
      from: { kind: 'user', userId },
      to: { kind: 'org', orgId: pre.org_id },
      amountMinor: Number(pre.amount_minor),
      currency: pre.currency,
      kind: 'merchant_payment',
      idempotencyKey: `miniapp:${id}`,
      initiatedBy: userId,
      metadata: { miniappId: pre.app_id, requestId: id, orgId: pre.org_id },
    };
    const limits = await this.ledger.prefetchLimits(input);
    let paidNow = false;
    await this.db.transaction(async (tx) => {
      const cur = await this.loadOwn(userId, id, true, tx);
      if (cur.status === 'paid') return;
      if (cur.status !== 'pending') throw AppError.conflict('This payment request can no longer be confirmed', { reason: 'request_closed', status: cur.status });
      if (new Date(cur.expires_at) <= new Date()) throw AppError.conflict('This payment request has expired', { reason: 'request_expired' });
      const res = await this.ledger.transfer(input, tx, limits);
      if (!res.ok) {
        if (res.reason === 'insufficient_funds') throw AppError.conflict('Insufficient funds', { reason: 'insufficient_funds' });
        if (res.reason === 'limit_exceeded') throw AppError.conflict('Transfer limit exceeded', { reason: 'limit_exceeded' });
        if (res.reason === 'account_frozen') throw new AppError(403, ErrorCodes.forbidden, 'An account involved is frozen', { reason: 'account_frozen' });
        throw AppError.conflict('Payment could not be made', { reason: 'invalid_counterparty' });
      }
      await tx.execute(sql`
        UPDATE miniapp_payment_requests SET status = 'paid', transfer_id = ${res.transferId}::uuid, decided_at = now() WHERE id = ${id}::uuid`);
      await this.audit.record(
        { action: 'miniapp.payment_confirmed', actorUserId: userId, meta, metadata: { appId: pre.app_id, requestId: id, transferId: res.transferId, amountMinor: Number(pre.amount_minor), currency: pre.currency } },
        tx,
      );
      await this.usage.bump(pre.app_id, 'payments_confirmed', tx);
      paidNow = true;
    });
    if (paidNow) {
      this.hooks.emit(pre.app_id, userId, 'payment.confirmed', { paymentRequestId: id, clientRef: pre.client_ref, amountMinor: Number(pre.amount_minor), currency: pre.currency });
    }
    return toPayment(await this.loadOwn(userId, id));
  }
}
