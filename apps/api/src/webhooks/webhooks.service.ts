import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateWebhookRequest,
  ErrorCodes,
  type UpdateWebhookRequest,
  type Webhook,
  type WebhookDelivery,
  type WebhookDeliveryList,
  type WebhookEvent,
  type WebhookList,
  type WebhookWithSecret,
  WEBHOOKS_PER_ORG,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { decodeKeyMaterial, ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { resolvedAddressesAllowed, validateWebhookUrl } from './url-guard.js';
import { NodeWebhookTransport, type WebhookTransport } from './webhook-transport.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WEBHOOK_TIMEOUT_MS = 5000;
export const WEBHOOK_MAX_ATTEMPTS = 3;
/** Consecutive failed attempts after which a subscription is switched off. */
export const WEBHOOK_MAX_FAILURES = 10;
/** Deliveries kept per subscription (journal). */
export const WEBHOOK_JOURNAL_KEEP = 100;
/** Wait before attempt 2 and 3. */
const BACKOFF_MINUTES = [1, 10] as const;
/** A claimed delivery is not retried by another worker for this long (crash safety). */
const LEASE_MINUTES = 2;
const DUE_BATCH = 100;

type Data = Record<string, string | number | boolean | null>;
type Hook = { id: string; org_id: string; url: string; secret_enc: string; events: string[]; active: boolean; failure_count: number; last_status: number | null; last_delivery_at: Date | null; disabled_at: Date | null; created_at: Date };
type DeliveryRow = { id: string; event: string; status: 'pending' | 'delivered' | 'failed'; http_status: number | null; error_code: string | null; attempt: number; created_at: Date; next_attempt_at: Date | null };

const HOOK_COLS = sql`id, org_id, url, secret_enc, events, active, failure_count, last_status, last_delivery_at, disabled_at, created_at`;
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toWebhook = (r: Hook): Webhook => ({ id: r.id, url: r.url, events: r.events as WebhookEvent[], active: r.active, failureCount: r.failure_count, lastStatus: r.last_status, lastDeliveryAt: iso(r.last_delivery_at), disabledAt: iso(r.disabled_at), createdAt: iso(r.created_at)! });
const toDelivery = (r: DeliveryRow): WebhookDelivery => ({ id: r.id, event: r.event, status: r.status, httpStatus: r.http_status, attempt: r.attempt, errorCode: r.error_code, createdAt: iso(r.created_at)!, nextAttemptAt: iso(r.next_attempt_at) });
const notFound = () => AppError.notFound('Webhook not found');
const refused = (reason: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'url', message: `url_${reason}` }]);
const arrayOf = (events: string[]) => sql`ARRAY[${sql.join(events.map((e) => sql`${e}`), sql`, `)}]::text[]`;

/** `whsec_` + 32 random bytes. */
export const newSecret = (): string => `whsec_${randomBytes(32).toString('base64url')}`;

/** HMAC-SHA256 hex of `${timestamp}.${body}` : what receivers recompute to check a delivery. */
export const signPayload = (secret: string, timestamp: string, body: string): string => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/**
 * Outgoing webhooks. Events are queued in the database and sent right after, outside the request that produced them:
 * `emit` never throws and never waits, so the originating operation is neither failed nor slowed. Retries (1 min, then
 * 10 min) are picked up by the hourly maintenance (`processDue`). Payloads hold ids, status, amounts and currency only.
 * Audit holds the id, the events and the host, never the full URL nor the secret.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly key: Buffer;
  private readonly inflight = new Set<Promise<void>>();
  /** Replaced in tests. */
  transport: WebhookTransport = new NodeWebhookTransport();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    const material = env.TOTP_ENCRYPTION_KEY ? decodeKeyMaterial(env.TOTP_ENCRYPTION_KEY) : Buffer.from(env.JWT_ACCESS_SECRET);
    this.key = createHash('sha256').update('webhook-secret:').update(material).digest();
  }

  /* ---------------------------------------------------------------- secrets */

  /** AES-256-GCM bound to the subscription id (AAD): `v1:<iv>:<tag>:<ciphertext>`. */
  private seal(id: string, plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from(`webhook:${id}`));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
  }

  private open(id: string, stored: string): string {
    const [v, iv, tag, ct] = stored.split(':');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported ciphertext');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(`webhook:${id}`));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }

  /* ---------------------------------------------------------------- management */

  private guard(raw: string): { href: string; host: string } {
    const g = validateWebhookUrl(raw, { production: this.env.NODE_ENV === 'production' });
    if (!g.ok) throw refused(g.reason);
    if (g.url.href.length > 500) throw refused('invalid');
    return { href: g.url.href, host: g.host };
  }

  private async find(orgId: string, id: string, lock = false): Promise<Hook> {
    if (!UUID_RE.test(id)) throw notFound();
    const res = await this.db.execute<Hook>(sql`SELECT ${HOOK_COLS} FROM org_webhooks WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid ${lock ? sql`FOR UPDATE` : sql``}`);
    if (!res.rows[0]) throw notFound();
    return res.rows[0];
  }

  async list(orgId: string): Promise<WebhookList> {
    const res = await this.db.execute<Hook>(sql`SELECT ${HOOK_COLS} FROM org_webhooks WHERE org_id = ${orgId}::uuid ORDER BY created_at, id`);
    return { items: res.rows.map(toWebhook) };
  }

  async create(orgId: string, userId: string, body: CreateWebhookRequest, meta: RequestMeta): Promise<WebhookWithSecret> {
    const { href, host } = this.guard(body.url);
    const id = randomUUID();
    const secret = newSecret();
    const row = await this.db.transaction(async (tx) => {
      // Serialises creations so the cap cannot be overshot by parallel requests.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'webhooks:' + orgId}, 0))`);
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM org_webhooks WHERE org_id = ${orgId}::uuid`);
      if ((n.rows[0]?.n ?? 0) >= WEBHOOKS_PER_ORG) throw AppError.conflict(`At most ${WEBHOOKS_PER_ORG} webhooks per organization`, { reason: 'limit', limit: WEBHOOKS_PER_ORG });
      const ins = await tx.execute<Hook>(sql`
        INSERT INTO org_webhooks (id, org_id, url, secret_enc, events, created_by)
        VALUES (${id}::uuid, ${orgId}::uuid, ${href}, ${this.seal(id, secret)}, ${arrayOf(body.events)}, ${userId}::uuid)
        RETURNING ${HOOK_COLS}`);
      await this.audit.record({ action: 'org.webhook_created', actorUserId: userId, meta, metadata: { orgId, webhookId: id, events: body.events, host } }, tx);
      return ins.rows[0]!;
    });
    return { ...toWebhook(row), secret };
  }

  async update(orgId: string, userId: string, id: string, body: UpdateWebhookRequest, meta: RequestMeta): Promise<Webhook> {
    const g = body.url !== undefined ? this.guard(body.url) : undefined;
    const row = await this.db.transaction(async (tx) => {
      if (!UUID_RE.test(id)) throw notFound();
      const cur = await tx.execute<Hook>(sql`SELECT ${HOOK_COLS} FROM org_webhooks WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`);
      if (!cur.rows[0]) throw notFound();
      // Switching a subscription back on forgives the past failures.
      const revive = body.active === true && !cur.rows[0].active;
      const upd = await tx.execute<Hook>(sql`
        UPDATE org_webhooks SET
          url = ${g?.href ?? cur.rows[0].url},
          events = ${body.events ? arrayOf(body.events) : sql`events`},
          active = ${body.active ?? cur.rows[0].active},
          failure_count = ${revive ? 0 : cur.rows[0].failure_count},
          disabled_at = ${revive ? null : cur.rows[0].disabled_at},
          updated_at = now()
        WHERE id = ${id}::uuid RETURNING ${HOOK_COLS}`);
      await this.audit.record(
        { action: 'org.webhook_updated', actorUserId: userId, meta, metadata: { orgId, webhookId: id, events: upd.rows[0]!.events, host: g?.host, active: upd.rows[0]!.active } },
        tx,
      );
      return upd.rows[0]!;
    });
    return toWebhook(row);
  }

  async rotateSecret(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<WebhookWithSecret> {
    const secret = newSecret();
    const row = await this.db.transaction(async (tx) => {
      if (!UUID_RE.test(id)) throw notFound();
      const upd = await tx.execute<Hook>(sql`
        UPDATE org_webhooks SET secret_enc = ${this.seal(id, secret)}, updated_at = now()
        WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid RETURNING ${HOOK_COLS}`);
      if (!upd.rows[0]) throw notFound();
      await this.audit.record({ action: 'org.webhook_secret_rotated', actorUserId: userId, meta, metadata: { orgId, webhookId: id } }, tx);
      return upd.rows[0];
    });
    return { ...toWebhook(row), secret };
  }

  async remove(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (!UUID_RE.test(id)) throw notFound();
      const del = await tx.execute<{ url: string }>(sql`DELETE FROM org_webhooks WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid RETURNING url`);
      if (!del.rows[0]) throw notFound();
      await this.audit.record({ action: 'org.webhook_deleted', actorUserId: userId, meta, metadata: { orgId, webhookId: id } }, tx);
    });
  }

  async deliveries(orgId: string, id: string): Promise<WebhookDeliveryList> {
    await this.find(orgId, id);
    const res = await this.db.execute<DeliveryRow>(sql`
      SELECT id, event, status, http_status, error_code, attempt, created_at, next_attempt_at FROM org_webhook_deliveries
      WHERE webhook_id = ${id}::uuid ORDER BY created_at DESC, id DESC LIMIT 50`);
    return { items: res.rows.map(toDelivery) };
  }

  /** Sends one `ping` now, without retries, and returns how it went (no body of the response is ever kept). */
  async ping(orgId: string, id: string): Promise<WebhookDelivery> {
    await this.find(orgId, id);
    const recent = await this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM org_webhook_deliveries WHERE webhook_id = ${id}::uuid AND event = 'ping' AND created_at > now() - interval '1 minute'`);
    if ((recent.rows[0]?.n ?? 0) >= 5) throw AppError.conflict('Too many tests, try again in a minute', { reason: 'rate_limited' });
    const deliveryId = await this.enqueueOne(id, orgId, 'ping', { ping: true });
    await this.attempt(deliveryId, { retry: false });
    const res = await this.db.execute<DeliveryRow>(sql`SELECT id, event, status, http_status, error_code, attempt, created_at, next_attempt_at FROM org_webhook_deliveries WHERE id = ${deliveryId}::uuid`);
    return toDelivery(res.rows[0]!);
  }

  /* ---------------------------------------------------------------- emission */

  /**
   * Queues `event` for every active subscription of the organisation that listens to it, then sends. Fire and forget:
   * call it after the commit of the originating operation; it never throws and never waits.
   */
  emit(orgId: string, event: WebhookEvent, data: Data): void {
    const p: Promise<void> = this.enqueue(orgId, event, data)
      .catch((err: unknown) => this.logger.warn(`webhook emit failed: ${(err as Error).name}`))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Resolves when every emission started so far has been sent (tests; graceful stop). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private async enqueue(orgId: string, event: WebhookEvent, data: Data): Promise<void> {
    const hooks = await this.db.execute<{ id: string }>(sql`SELECT id FROM org_webhooks WHERE org_id = ${orgId}::uuid AND active AND ${event}::text = ANY(events)`);
    await Promise.all(
      hooks.rows.map(async (h) => {
        const deliveryId = await this.enqueueOne(h.id, orgId, event, data);
        await this.attempt(deliveryId, { retry: true });
      }),
    );
  }

  private async enqueueOne(webhookId: string, orgId: string, event: string, data: Data): Promise<string> {
    const id = randomUUID();
    const body = JSON.stringify({ id, event, createdAt: new Date().toISOString(), orgId, data });
    await this.db.execute(sql`
      INSERT INTO org_webhook_deliveries (id, webhook_id, event, payload, payload_digest, next_attempt_at)
      VALUES (${id}::uuid, ${webhookId}::uuid, ${event}, ${body}, ${createHash('sha256').update(body).digest('hex')}, now())`);
    return id;
  }

  /* ---------------------------------------------------------------- sending */

  /** Maintenance: sends what is due (retries, deliveries a crash left behind). */
  async processDue(): Promise<number> {
    const due = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM org_webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT ${DUE_BATCH}`);
    for (let i = 0; i < due.rows.length; i += 10) {
      await Promise.all(due.rows.slice(i, i + 10).map((r) => this.attempt(r.id, { retry: true }).catch((err: unknown) => this.logger.warn(`webhook attempt failed: ${(err as Error).name}`))));
    }
    return due.rows.length;
  }

  /** Journal bound: the 100 newest deliveries per subscription survive. */
  async purge(): Promise<number> {
    const res = await this.db.execute(sql`
      DELETE FROM org_webhook_deliveries WHERE id IN (
        SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY webhook_id ORDER BY created_at DESC, id DESC) AS rn FROM org_webhook_deliveries) t
        WHERE rn > ${WEBHOOK_JOURNAL_KEEP})`);
    return res.rowCount ?? 0;
  }

  /** Claims the delivery (lease), sends it, records the outcome and counts the failure on the subscription. */
  private async attempt(deliveryId: string, opts: { retry: boolean }): Promise<void> {
    const claimed = await this.db.execute<{ id: string; event: string; payload: string; attempt: number; webhook_id: string; org_id: string; url: string; secret_enc: string; active: boolean }>(sql`
      UPDATE org_webhook_deliveries d SET attempt = d.attempt + 1, next_attempt_at = now() + make_interval(mins => ${LEASE_MINUTES})
      FROM org_webhooks w
      WHERE d.id = ${deliveryId}::uuid AND w.id = d.webhook_id AND d.status = 'pending' AND d.next_attempt_at <= now()
      RETURNING d.id, d.event, d.payload, d.attempt, w.id AS webhook_id, w.org_id, w.url, w.secret_enc, w.active`);
    const d = claimed.rows[0];
    if (!d) return;
    if (!d.active && d.event !== 'ping') {
      await this.db.execute(sql`UPDATE org_webhook_deliveries SET status = 'failed', error_code = 'disabled', next_attempt_at = NULL WHERE id = ${d.id}::uuid`);
      return;
    }
    const out = await this.send(d);
    const ok = out.httpStatus !== null && out.httpStatus >= 200 && out.httpStatus < 300;
    const code = ok ? null : out.errorCode;
    const final = ok || !opts.retry || d.attempt >= WEBHOOK_MAX_ATTEMPTS;
    const wait = BACKOFF_MINUTES[d.attempt - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]!;
    await this.db.execute(sql`
      UPDATE org_webhook_deliveries SET status = ${ok ? 'delivered' : final ? 'failed' : 'pending'}, http_status = ${out.httpStatus}, error_code = ${code},
        next_attempt_at = ${final ? sql`NULL` : sql`now() + make_interval(mins => ${wait})`}
      WHERE id = ${d.id}::uuid`);
    if (d.event === 'ping') return; // a test never moves the failure counter
    if (ok) {
      await this.db.execute(sql`UPDATE org_webhooks SET failure_count = 0, last_status = ${out.httpStatus}, last_delivery_at = now() WHERE id = ${d.webhook_id}::uuid`);
      return;
    }
    const upd = await this.db.execute<{ just_disabled: boolean }>(sql`
      UPDATE org_webhooks SET failure_count = failure_count + 1, last_status = ${out.httpStatus ?? 0}, last_delivery_at = now(),
        active = CASE WHEN failure_count + 1 >= ${WEBHOOK_MAX_FAILURES} THEN false ELSE active END,
        disabled_at = CASE WHEN active AND failure_count + 1 >= ${WEBHOOK_MAX_FAILURES} THEN now() ELSE disabled_at END
      WHERE id = ${d.webhook_id}::uuid RETURNING (disabled_at = now()) AS just_disabled`);
    if (upd.rows[0]?.just_disabled) await this.onDisabled(d.org_id, d.webhook_id, d.url);
  }

  private async onDisabled(orgId: string, webhookId: string, url: string): Promise<void> {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* stored URLs were validated */
    }
    await this.audit.record({ action: 'org.webhook_disabled', metadata: { orgId, webhookId, host, reason: 'consecutive_failures' } });
    const owners = await this.db.execute<{ user_id: string }>(sql`SELECT user_id FROM org_members WHERE org_id = ${orgId}::uuid AND role = 'owner' AND status = 'active'`);
    await this.notifications.notifyMany(
      owners.rows.map((o) => ({
        userId: o.user_id,
        category: 'system' as const,
        title: 'Webhook désactivé',
        body: 'Un webhook de votre organisation a été désactivé après plusieurs échecs consécutifs. Vérifiez-le dans l’application.',
        data: { orgId, webhookId },
      })),
    );
  }

  /** URL guard, DNS resolution checked at send time (anti-rebinding), connection to the verified address, 5 s budget. */
  private async send(d: { id: string; event: string; payload: string; webhook_id: string; url: string; secret_enc: string }): Promise<{ httpStatus: number | null; errorCode: string | null }> {
    try {
      const g = validateWebhookUrl(d.url, { production: this.env.NODE_ENV === 'production' });
      if (!g.ok) return { httpStatus: null, errorCode: 'blocked' };
      const addresses = await this.transport.lookup(g.host);
      if (!resolvedAddressesAllowed(addresses, g.devLoopback)) return { httpStatus: null, errorCode: 'blocked' };
      const timestamp = String(Math.floor(Date.now() / 1000));
      const secret = this.open(d.webhook_id, d.secret_enc);
      const res = await this.transport.post({
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
