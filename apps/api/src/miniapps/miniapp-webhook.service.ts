import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  type CreateMiniAppWebhookRequest,
  ErrorCodes,
  type MiniAppEvent,
  type MiniAppWebhook,
  type MiniAppWebhookWithSecret,
  type WebhookDelivery,
  type WebhookDeliveryList,
  readManifest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { resolvedAddressesAllowed, validateWebhookUrl } from '../webhooks/url-guard.js';
import { newSecret, signPayload, WEBHOOK_JOURNAL_KEEP, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_MAX_FAILURES, WEBHOOK_TIMEOUT_MS, WebhookService } from '../webhooks/webhooks.service.js';
import { MiniAppDevService } from './miniapp-dev.service.js';
import { appSubject } from './miniapps.shared.js';

type Hook = { id: string; miniapp_id: string; url: string; secret_enc: string; events: string[]; active: boolean; failure_count: number; last_status: number | null; last_delivery_at: Date | null; disabled_at: Date | null; created_at: Date };
type DeliveryRow = { id: string; event: string; status: 'pending' | 'delivered' | 'failed'; http_status: number | null; error_code: string | null; attempt: number; created_at: Date; next_attempt_at: Date | null };

const COLS = sql`id, miniapp_id, url, secret_enc, events, active, failure_count, last_status, last_delivery_at, disabled_at, created_at`;
const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);
const toHook = (r: Hook): MiniAppWebhook => ({ id: r.id, url: r.url, events: r.events as MiniAppEvent[], active: r.active, failureCount: r.failure_count, lastStatus: r.last_status, lastDeliveryAt: iso(r.last_delivery_at), disabledAt: iso(r.disabled_at), createdAt: iso(r.created_at)! });
const toDelivery = (r: DeliveryRow): WebhookDelivery => ({ id: r.id, event: r.event, status: r.status, httpStatus: r.http_status, attempt: r.attempt, errorCode: r.error_code, createdAt: iso(r.created_at)!, nextAttemptAt: iso(r.next_attempt_at) });
const refused = (path: string, message: string): AppError => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
const arrayOf = (events: readonly string[]) => sql`ARRAY[${sql.join(events.map((e) => sql`${e}`), sql`, `)}]::text[]`;
const BACKOFF_MINUTES = [1, 10] as const;
const LEASE_MINUTES = 2;

/** Data an event may carry: opaque ids of the app, never the global user id, never a name or a contact. */
export type EventData = Record<string, string | number | boolean | null | string[]>;

/**
 * Outgoing events to mini-apps (one webhook per application). Same machinery as organisation webhooks (sealed secret,
 * HMAC `${timestamp}.${body}`, X-Caselind-* headers, DNS-verified anti-SSRF delivery, retries 1 min then 10 min, switch-off after
 * 10 consecutive failed deliveries, bounded journal) but subscriptions are limited to the events the approved manifest declares.
 */
@Injectable()
export class MiniAppWebhookService {
  private readonly logger = new Logger(MiniAppWebhookService.name);
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly sealer: WebhookService,
    private readonly dev: MiniAppDevService,
  ) {}

  // ---- management (owner of the application) ----------------------------------------------------------

  private guard(raw: string): { href: string; host: string } {
    const g = validateWebhookUrl(raw, { production: this.env.NODE_ENV !== 'test' });
    if (!g.ok) throw refused('url', `url_${g.reason}`);
    if (g.url.href.length > 500) throw refused('url', 'url_invalid');
    return { href: g.url.href, host: g.host };
  }

  private async find(appId: string): Promise<Hook> {
    const res = await this.db.execute<Hook>(sql`SELECT ${COLS} FROM miniapp_webhooks WHERE miniapp_id = ${appId}::uuid`);
    if (!res.rows[0]) throw AppError.notFound('Webhook not found');
    return res.rows[0];
  }

  async get(userId: string, appId: string): Promise<MiniAppWebhook> {
    await this.dev.ownedApp(userId, appId, false);
    return toHook(await this.find(appId));
  }

  async create(userId: string, appId: string, body: CreateMiniAppWebhookRequest, meta: RequestMeta): Promise<MiniAppWebhookWithSecret> {
    const app = await this.dev.ownedApp(userId, appId, true);
    const manifest = readManifest(app.manifest);
    const declared = manifest?.events ?? [];
    if (declared.length === 0) throw refused('events', 'the manifest declares no event');
    const events = body.events ?? declared;
    const outside = events.filter((e) => !declared.includes(e));
    if (outside.length > 0) throw AppError.conflict('An event is not declared in the manifest', { reason: 'event_not_declared', events: outside });
    const { href, host } = this.guard(body.url);
    const id = randomUUID();
    const secret = newSecret();
    const row = await this.db.transaction(async (tx) => {
      const ins = await tx.execute<Hook>(sql`
        INSERT INTO miniapp_webhooks (id, miniapp_id, url, secret_enc, events, created_by)
        VALUES (${id}::uuid, ${appId}::uuid, ${href}, ${this.sealer.seal(id, secret)}, ${arrayOf(events)}, ${userId}::uuid)
        ON CONFLICT (miniapp_id) DO NOTHING RETURNING ${COLS}`);
      if (!ins.rows[0]) throw AppError.conflict('This application already has a webhook', { reason: 'exists' });
      await this.audit.record({ action: 'miniapp.webhook_created', actorUserId: userId, meta, metadata: { appId, webhookId: id, events, host } }, tx);
      return ins.rows[0];
    });
    return { ...toHook(row), secret };
  }

  async rotateSecret(userId: string, appId: string, meta: RequestMeta): Promise<MiniAppWebhookWithSecret> {
    await this.dev.ownedApp(userId, appId, true);
    const cur = await this.find(appId);
    const secret = newSecret();
    const row = await this.db.transaction(async (tx) => {
      const upd = await tx.execute<Hook>(sql`UPDATE miniapp_webhooks SET secret_enc = ${this.sealer.seal(cur.id, secret)}, updated_at = now() WHERE id = ${cur.id}::uuid RETURNING ${COLS}`);
      await this.audit.record({ action: 'miniapp.webhook_secret_rotated', actorUserId: userId, meta, metadata: { appId, webhookId: cur.id } }, tx);
      return upd.rows[0]!;
    });
    return { ...toHook(row), secret };
  }

  async remove(userId: string, appId: string, meta: RequestMeta): Promise<void> {
    await this.dev.ownedApp(userId, appId, true);
    await this.db.transaction(async (tx) => {
      const del = await tx.execute<{ id: string }>(sql`DELETE FROM miniapp_webhooks WHERE miniapp_id = ${appId}::uuid RETURNING id`);
      if (!del.rows[0]) throw AppError.notFound('Webhook not found');
      await this.audit.record({ action: 'miniapp.webhook_deleted', actorUserId: userId, meta, metadata: { appId, webhookId: del.rows[0].id } }, tx);
    });
  }

  async deliveries(userId: string, appId: string): Promise<WebhookDeliveryList> {
    await this.dev.ownedApp(userId, appId, false);
    const hook = await this.find(appId);
    const res = await this.db.execute<DeliveryRow>(sql`
      SELECT id, event, status, http_status, error_code, attempt, created_at, next_attempt_at FROM miniapp_webhook_deliveries
      WHERE webhook_id = ${hook.id}::uuid ORDER BY created_at DESC, id DESC LIMIT 50`);
    return { items: res.rows.map(toDelivery) };
  }

  /** One signed `ping` now, no retry, at most 5 a minute. Also switches the hook back on when it was disabled and the test passes. */
  async test(userId: string, appId: string): Promise<WebhookDelivery> {
    await this.dev.ownedApp(userId, appId, true);
    const hook = await this.find(appId);
    const recent = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM miniapp_webhook_deliveries WHERE webhook_id = ${hook.id}::uuid AND event = 'ping' AND created_at > now() - interval '1 minute'`);
    if ((recent.rows[0]?.n ?? 0) >= 5) throw AppError.conflict('Too many tests, try again in a minute', { reason: 'rate_limited' });
    const id = await this.enqueueOne(hook.id, appId, 'ping', { ping: true });
    await this.attempt(id, { retry: false });
    const res = await this.db.execute<DeliveryRow>(sql`SELECT id, event, status, http_status, error_code, attempt, created_at, next_attempt_at FROM miniapp_webhook_deliveries WHERE id = ${id}::uuid`);
    // A passing test forgives the past failures and switches a disabled hook back on.
    if (res.rows[0]!.status === 'delivered') await this.db.execute(sql`UPDATE miniapp_webhooks SET active = true, failure_count = 0, disabled_at = NULL WHERE id = ${hook.id}::uuid AND NOT active`);
    return toDelivery(res.rows[0]!);
  }

  // ---- emission ---------------------------------------------------------------------------------------

  /**
   * Queues `event` for the user's app and sends it. Fire and forget (never throws, never waits): call it after the commit.
   * Only the app-scoped subject (`sub`) identifies the user. The subscription must still be declared by the approved manifest.
   */
  emit(appId: string, userId: string, event: MiniAppEvent, data: EventData = {}): void {
    const p: Promise<void> = this.enqueue(appId, event, { sub: appSubject(this.env, appId, userId), ...data })
      .catch((err: unknown) => this.logger.warn(`miniapp event failed: ${(err as Error).name}`))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Resolves when every emission started so far has been sent (tests, graceful stop). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private async enqueue(appId: string, event: MiniAppEvent, data: EventData): Promise<void> {
    const hooks = await this.db.execute<{ id: string }>(sql`
      SELECT w.id FROM miniapp_webhooks w JOIN miniapps a ON a.id = w.miniapp_id
      WHERE w.miniapp_id = ${appId}::uuid AND w.active AND ${event}::text = ANY(w.events) AND jsonb_exists(a.manifest->'events', ${event}::text)`);
    await Promise.all(
      hooks.rows.map(async (h) => {
        const id = await this.enqueueOne(h.id, appId, event, data);
        await this.attempt(id, { retry: true });
      }),
    );
  }

  private async enqueueOne(webhookId: string, appId: string, event: string, data: EventData): Promise<string> {
    const id = randomUUID();
    const body = JSON.stringify({ id, event, createdAt: new Date().toISOString(), appId, data });
    await this.db.execute(sql`
      INSERT INTO miniapp_webhook_deliveries (id, webhook_id, event, payload, payload_digest, next_attempt_at)
      VALUES (${id}::uuid, ${webhookId}::uuid, ${event}, ${body}, ${createHash('sha256').update(body).digest('hex')}, now())`);
    return id;
  }

  // ---- sending ----------------------------------------------------------------------------------------

  @Interval('miniapp-webhook-retries', 60_000)
  async retryDue(): Promise<void> {
    await this.processDue().catch((err: unknown) => this.logger.warn(`miniapp webhook retries failed: ${(err as Error).name}`));
  }

  async processDue(): Promise<number> {
    const due = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM miniapp_webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 100`);
    for (let i = 0; i < due.rows.length; i += 10) {
      await Promise.all(due.rows.slice(i, i + 10).map((r) => this.attempt(r.id, { retry: true }).catch((err: unknown) => this.logger.warn(`miniapp webhook attempt failed: ${(err as Error).name}`))));
    }
    return due.rows.length;
  }

  /** Journal bound: the newest 100 deliveries per application survive. */
  async purge(): Promise<number> {
    const res = await this.db.execute(sql`
      DELETE FROM miniapp_webhook_deliveries WHERE id IN (
        SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY webhook_id ORDER BY created_at DESC, id DESC) AS rn FROM miniapp_webhook_deliveries) t
        WHERE rn > ${WEBHOOK_JOURNAL_KEEP}) AND status <> 'pending'`);
    return res.rowCount ?? 0;
  }

  private async attempt(deliveryId: string, opts: { retry: boolean }): Promise<void> {
    const claimed = await this.db.execute<{ id: string; event: string; payload: string; attempt: number; webhook_id: string; miniapp_id: string; url: string; secret_enc: string; active: boolean }>(sql`
      UPDATE miniapp_webhook_deliveries d SET attempt = d.attempt + 1, next_attempt_at = now() + make_interval(mins => ${LEASE_MINUTES})
      FROM miniapp_webhooks w
      WHERE d.id = ${deliveryId}::uuid AND w.id = d.webhook_id AND d.status = 'pending' AND d.next_attempt_at <= now()
      RETURNING d.id, d.event, d.payload, d.attempt, w.id AS webhook_id, w.miniapp_id, w.url, w.secret_enc, w.active`);
    const d = claimed.rows[0];
    if (!d) return;
    if (!d.active && d.event !== 'ping') {
      await this.db.execute(sql`UPDATE miniapp_webhook_deliveries SET status = 'failed', error_code = 'disabled', next_attempt_at = NULL WHERE id = ${d.id}::uuid`);
      return;
    }
    const out = await this.send(d);
    const ok = out.httpStatus !== null && out.httpStatus >= 200 && out.httpStatus < 300;
    const final = ok || !opts.retry || d.attempt >= WEBHOOK_MAX_ATTEMPTS;
    const wait = BACKOFF_MINUTES[d.attempt - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]!;
    await this.db.execute(sql`
      UPDATE miniapp_webhook_deliveries SET status = ${ok ? 'delivered' : final ? 'failed' : 'pending'}, http_status = ${out.httpStatus}, error_code = ${ok ? null : out.errorCode},
        next_attempt_at = ${final ? sql`NULL` : sql`now() + make_interval(mins => ${wait})`}
      WHERE id = ${d.id}::uuid`);
    if (d.event === 'ping') return;
    if (out.errorCode === 'secret') return; // our configuration, not the receiver's fault
    if (ok) {
      await this.db.execute(sql`UPDATE miniapp_webhooks SET failure_count = 0, last_status = ${out.httpStatus}, last_delivery_at = now() WHERE id = ${d.webhook_id}::uuid`);
      return;
    }
    if (!final) return;
    const upd = await this.db.execute<{ just_disabled: boolean }>(sql`
      UPDATE miniapp_webhooks SET failure_count = failure_count + 1, last_status = ${out.httpStatus ?? 0}, last_delivery_at = now(),
        active = CASE WHEN failure_count + 1 >= ${WEBHOOK_MAX_FAILURES} THEN false ELSE active END,
        disabled_at = CASE WHEN active AND failure_count + 1 >= ${WEBHOOK_MAX_FAILURES} THEN now() ELSE disabled_at END
      WHERE id = ${d.webhook_id}::uuid RETURNING (disabled_at = now()) AS just_disabled`);
    if (upd.rows[0]?.just_disabled) await this.onDisabled(d.miniapp_id, d.webhook_id, d.url);
  }

  private async onDisabled(appId: string, webhookId: string, url: string): Promise<void> {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* stored URLs were validated */
    }
    await this.audit.record({ action: 'miniapp.webhook_disabled', metadata: { appId, webhookId, host, reason: 'consecutive_failures' } });
    const owners = await this.db.execute<{ user_id: string }>(sql`
      SELECT m.user_id FROM miniapps a JOIN org_members m ON m.org_id = a.org_id AND m.role = 'owner' AND m.status = 'active' WHERE a.id = ${appId}::uuid`);
    await this.notifications.notifyMany(
      owners.rows.map((o) => ({
        userId: o.user_id,
        category: 'system' as const,
        title: 'Webhook d’application désactivé',
        body: 'Le webhook d’une de vos applications a été désactivé après plusieurs échecs consécutifs. Corrigez-le puis testez-le.',
        data: { kind: 'miniapp_webhook_disabled', appId, webhookId },
      })),
    );
  }

  private async send(d: { id: string; event: string; payload: string; webhook_id: string; url: string; secret_enc: string }): Promise<{ httpStatus: number | null; errorCode: string | null }> {
    try {
      const g = validateWebhookUrl(d.url, { production: this.env.NODE_ENV !== 'test' });
      if (!g.ok) return { httpStatus: null, errorCode: 'blocked' };
      const transport = this.sealer.transport;
      const addresses = await transport.lookup(g.host);
      if (!resolvedAddressesAllowed(addresses, g.devLoopback)) return { httpStatus: null, errorCode: 'blocked' };
      const timestamp = String(Math.floor(Date.now() / 1000));
      let secret: string;
      try {
        secret = this.sealer.open(d.webhook_id, d.secret_enc);
      } catch {
        return { httpStatus: null, errorCode: 'secret' };
      }
      const res = await transport.post({
        url: g.url,
        address: addresses[0]!,
        timeoutMs: WEBHOOK_TIMEOUT_MS,
        body: d.payload,
        headers: {
          'X-Caselind-Event': d.event,
          'X-Caselind-Delivery': d.id,
          'X-Caselind-Timestamp': timestamp,
          'X-Caselind-Signature': signPayload(secret, timestamp, d.payload),
        },
      });
      return { httpStatus: res.status, errorCode: res.status >= 200 && res.status < 300 ? null : 'http' };
    } catch (err) {
      return { httpStatus: null, errorCode: (err as Error).name === 'WebhookTimeoutError' || (err as Error).message === 'timeout' ? 'timeout' : 'network' };
    }
  }
}
