import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Env, ENV } from '../src/config/env.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import type { WebhookPostRequest, WebhookTransport } from '../src/webhooks/webhook-transport.js';
import { WEBHOOK_EVENTS_PER_MINUTE, WebhookService } from '../src/webhooks/webhooks.service.js';
import { FakeCatalog, installFakeCatalog } from './fake-catalog.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Stands in for the network: nothing in this file ever opens a socket. */
class FakeTransport implements WebhookTransport {
  readonly calls: WebhookPostRequest[] = [];
  readonly dns = new Map<string, string[]>();
  /** HTTP status to answer, or an Error to throw. */
  respond: number | Error = 200;
  async lookup(host: string): Promise<string[]> {
    return this.dns.get(host) ?? ['93.184.216.34'];
  }
  async post(req: WebhookPostRequest): Promise<{ status: number }> {
    this.calls.push(req);
    if (this.respond instanceof Error) throw this.respond;
    return { status: this.respond };
  }
}

let ctx: TestContext;
let hooks: WebhookService;
const net = new FakeTransport();
const fake = new FakeCatalog();

beforeAll(async () => {
  ctx = await createTestContext();
  installFakeCatalog(ctx, fake);
  hooks = ctx.app.get(WebhookService);
  hooks.transport = net;
  await ctx.sql.query(`INSERT INTO feature_flags (key, description, enabled) VALUES ('commerce', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`);
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
  handle: string;
}
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}
let n = 0;
async function createOrg(owner: TU): Promise<string> {
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `hook-${Date.now().toString(36)}-${++n}`, name: 'Boutique Hooks', kind: 'shop' }).expect(201);
  return res.body.id;
}
async function addMember(orgId: string, owner: TU, m: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(owner.token)).send({ handle: m.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(m.token)).expect(200);
}
async function seller() {
  const owner = await user();
  const orgId = await createOrg(owner);
  return { owner, orgId, variant: fake.add({ orgId, currency: 'CDF', price: 10_000, stock: 500 }) };
}

const URL_OK = 'https://hooks.example.com/caselind';
const subscribe = (s: { owner: TU; orgId: string }, body: Record<string, unknown> = {}, token = s.owner.token) =>
  ctx.http.post(`/v1/orgs/${s.orgId}/webhooks`).set(bearer(token)).send({ url: URL_OK, events: ['order.created', 'order.status_changed', 'pos.sale_created', 'pos.sale_voided', 'org.question_asked'], ...body });
const deliveries = async (s: { owner: TU; orgId: string }, id: string) => (await ctx.http.get(`/v1/orgs/${s.orgId}/webhooks/${id}/deliveries`).set(bearer(s.owner.token)).expect(200)).body.items;
const hookOf = async (s: { owner: TU; orgId: string }, id: string) => (await ctx.http.get(`/v1/orgs/${s.orgId}/webhooks`).set(bearer(s.owner.token)).expect(200)).body.items.find((h: { id: string }) => h.id === id);
const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix', notes: 'Portail bleu' };
const checkout = (u: TU) => ctx.http.post('/v1/orders/checkout').set(bearer(u.token)).send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery' });
const signature = (secret: string, ts: string, body: string) => createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
const reset = () => {
  net.calls.length = 0;
  net.dns.clear();
  net.respond = 200;
};
const due = () => ctx.sql.query(`UPDATE org_webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`);

describe('management', () => {
  it('creates a webhook: the secret is shown once, stored encrypted, never in the list nor in the audit', async () => {
    const s = await seller();
    const res = await subscribe(s, { url: 'https://Hooks.Example.com/in?token=abc#frag' }).expect(201);
    expect(res.body.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(res.body).toMatchObject({ url: 'https://hooks.example.com/in?token=abc', active: true, failureCount: 0, lastStatus: null, disabledAt: null });
    const list = (await ctx.http.get(`/v1/orgs/${s.orgId}/webhooks`).set(bearer(s.owner.token)).expect(200)).body;
    expect(list.items).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(res.body.secret);
    expect(list.items[0].secret).toBeUndefined();
    const raw = await ctx.sql.query('SELECT secret_enc FROM org_webhooks WHERE id = $1', [res.body.id]);
    expect(raw.rows[0].secret_enc).toMatch(/^v2:[0-9a-f]{8}:/);
    expect(raw.rows[0].secret_enc).not.toContain(res.body.secret);
    const audit = JSON.stringify((await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'org.webhook_created' AND metadata->>'webhookId' = $1`, [res.body.id])).rows);
    expect(audit).toContain('hooks.example.com');
    expect(audit).not.toContain('token=abc');
    expect(audit).not.toContain(res.body.secret);
    await ctx.http.get(`/v1/orgs/${s.orgId}/webhooks`).expect(401);
  });

  it('can subscribe to every event of the contract (the database constraint must list them all)', async () => {
    const s = await seller();
    const res = await subscribe(s, { events: ['order.created', 'order.status_changed', 'pos.sale_created', 'pos.sale_voided', 'org.question_asked', 'order.return_requested'] }).expect(201);
    expect(res.body.events).toContain('order.return_requested');
  });

  it('refuses unsafe URLs (SSRF) with 400, http in production included', async () => {
    const s = await seller();
    const bad = ['https://127.0.0.1/h', 'https://10.0.0.5/h', 'https://192.168.1.1/h', 'https://169.254.169.254/latest', 'https://localhost/h', 'https://2130706433/h', 'https://[::1]/h', 'https://[::ffff:127.0.0.1]/h', 'https://db.internal/h', 'https://user:pw@example.com/h', 'https://example.com:8080/h', 'http://example.com/h', 'http://localhost:4000/h', 'ftp://example.com/h', 'not a url'];
    const env = ctx.app.get<Env>(ENV);
    const saved = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      for (const url of bad) {
        const r = await subscribe(s, { url });
        expect(r.status, url).toBe(400);
        expect(r.body.error.code).toBe('validation_failed');
      }
    } finally {
      env.NODE_ENV = saved;
    }
    // Outside production, http://localhost (any port) is the one allowed exception, for tests.
    await subscribe(s, { url: 'http://localhost:4000/h' }).expect(201);
    await subscribe(s, { url: 'http://127.0.0.1:4000/h' }).expect(400);
    expect((await ctx.http.get(`/v1/orgs/${s.orgId}/webhooks`).set(bearer(s.owner.token))).body.items).toHaveLength(1);
    await subscribe(s, { events: [] }).expect(400);
    await subscribe(s, { events: ['order.deleted'] }).expect(400);
  });

  it('is reserved to owners; strangers get 404; another organisation webhook is 404', async () => {
    const s = await seller();
    const other = await seller();
    const admin = await user();
    const manager = await user();
    const stranger = await user();
    await addMember(s.orgId, s.owner, admin, 'admin');
    await addMember(s.orgId, s.owner, manager, 'manager');
    for (const u of [admin, manager]) {
      await ctx.http.get(`/v1/orgs/${s.orgId}/webhooks`).set(bearer(u.token)).expect(403);
      await subscribe(s, {}, u.token).expect(403);
    }
    await ctx.http.get(`/v1/orgs/${s.orgId}/webhooks`).set(bearer(stranger.token)).expect(404);
    await subscribe(s, {}, stranger.token).expect(404);
    const mine = (await subscribe(s).expect(201)).body;
    await ctx.http.patch(`/v1/orgs/${other.orgId}/webhooks/${mine.id}`).set(bearer(other.owner.token)).send({ active: false }).expect(404);
    await ctx.http.delete(`/v1/orgs/${other.orgId}/webhooks/${mine.id}`).set(bearer(other.owner.token)).expect(404);
    await ctx.http.post(`/v1/orgs/${other.orgId}/webhooks/${mine.id}/test`).set(bearer(other.owner.token)).expect(404);
    await ctx.http.get(`/v1/orgs/${other.orgId}/webhooks/${mine.id}/deliveries`).set(bearer(other.owner.token)).expect(404);
    await ctx.http.delete(`/v1/orgs/${s.orgId}/webhooks/not-a-uuid`).set(bearer(s.owner.token)).expect(404);
    expect(manager.id).toBeTruthy();
  });

  it('caps at 5 per organisation, even in parallel', async () => {
    const s = await seller();
    const res = await Promise.all(Array.from({ length: 7 }, () => subscribe(s)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(5);
    const refused = res.find((r) => r.status === 409)!;
    expect(refused.body.error.details).toMatchObject({ reason: 'limit', limit: 5 });
  });

  it('edits (events, url, active), rotates the secret and deletes with the journal', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s, { events: ['order.created'] }).expect(201)).body;
    const upd = (await ctx.http.patch(`/v1/orgs/${s.orgId}/webhooks/${h.id}`).set(bearer(s.owner.token)).send({ events: ['pos.sale_created'], url: 'https://other.example.com/x' }).expect(200)).body;
    expect(upd).toMatchObject({ events: ['pos.sale_created'], url: 'https://other.example.com/x' });
    await ctx.http.patch(`/v1/orgs/${s.orgId}/webhooks/${h.id}`).set(bearer(s.owner.token)).send({}).expect(400);
    await ctx.http.patch(`/v1/orgs/${s.orgId}/webhooks/${h.id}`).set(bearer(s.owner.token)).send({ url: 'https://127.0.0.1/x' }).expect(400);

    const rot = (await ctx.http.post(`/v1/orgs/${s.orgId}/webhooks/${h.id}/rotate-secret`).set(bearer(s.owner.token)).expect(200)).body;
    expect(rot.secret).toMatch(/^whsec_/);
    expect(rot.secret).not.toBe(h.secret);
    await ctx.http.post(`/v1/orgs/${s.orgId}/webhooks/${h.id}/test`).set(bearer(s.owner.token)).expect(200);
    const call = net.calls[0]!;
    const ts = call.headers['X-Caselind-Timestamp']!;
    expect(call.headers['X-Caselind-Signature']).toBe(signature(rot.secret, ts, call.body));
    expect(call.headers['X-Caselind-Signature']).not.toBe(signature(h.secret, ts, call.body));

    await ctx.http.delete(`/v1/orgs/${s.orgId}/webhooks/${h.id}`).set(bearer(s.owner.token)).expect(204);
    await ctx.http.delete(`/v1/orgs/${s.orgId}/webhooks/${h.id}`).set(bearer(s.owner.token)).expect(404);
    expect((await ctx.sql.query('SELECT count(*)::int AS n FROM org_webhook_deliveries WHERE webhook_id = $1', [h.id])).rows[0].n).toBe(0);
  });
});

describe('delivery', () => {
  it('sends order.created and order.status_changed, signed, with a minimal payload (no customer data)', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s).expect(201)).body;
    const buyer = await user();
    await ctx.http.put(`/v1/cart/items/${s.variant}`).set(bearer(buyer.token)).send({ quantity: 2 }).expect(200);
    const order = (await checkout(buyer).expect(201)).body.orders[0];
    await hooks.idle();

    expect(net.calls).toHaveLength(1);
    const call = net.calls[0]!;
    expect(call.url.href).toBe(URL_OK);
    expect(call.address).toBe('93.184.216.34');
    const body = JSON.parse(call.body);
    expect(body).toMatchObject({ event: 'order.created', orgId: s.orgId, data: { orderId: order.id, number: order.number, status: 'pending', totalMinor: 20_000, currency: 'CDF', itemCount: 1 } });
    expect(Object.keys(body.data).sort()).toEqual(['currency', 'fulfillment', 'itemCount', 'number', 'orderId', 'status', 'totalMinor']);
    for (const secretish of ['Awa', 'Diallo', '+243', 'Kinshasa', 'avenue', 'Portail', buyer.id, buyer.handle]) expect(call.body).not.toContain(secretish);

    expect(call.headers['X-Caselind-Event']).toBe('order.created');
    expect(call.headers['X-Caselind-Delivery']).toBe(body.id);
    const ts = call.headers['X-Caselind-Timestamp']!;
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(30);
    expect(call.headers['X-Caselind-Signature']).toBe(signature(h.secret, ts, call.body));

    await ctx.http.post(`/v1/orgs/${s.orgId}/orders/${order.id}/status`).set(bearer(s.owner.token)).send({ status: 'confirmed', note: 'texte libre secret' }).expect(200);
    await hooks.idle();
    const second = JSON.parse(net.calls[1]!.body);
    expect(second).toMatchObject({ event: 'order.status_changed', data: { orderId: order.id, from: 'pending', to: 'confirmed', totalMinor: 20_000, currency: 'CDF' } });
    expect(net.calls[1]!.body).not.toContain('texte libre');

    const log = await deliveries(s, h.id);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ status: 'delivered', httpStatus: 200, attempt: 1, errorCode: null });
    expect(JSON.stringify(log)).not.toContain('payload');
    expect(await hookOf(s, h.id)).toMatchObject({ failureCount: 0, lastStatus: 200 });
  });

  it('sends only the events subscribed to, and nothing once inactive', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s, { events: ['pos.sale_voided'] }).expect(201)).body;
    const buyer = await user();
    await ctx.http.put(`/v1/cart/items/${s.variant}`).set(bearer(buyer.token)).send({ quantity: 1 }).expect(200);
    await checkout(buyer).expect(201);
    await hooks.idle();
    expect(net.calls).toHaveLength(0);
    await ctx.http.patch(`/v1/orgs/${s.orgId}/webhooks/${h.id}`).set(bearer(s.owner.token)).send({ events: ['order.created'], active: false }).expect(200);
    await ctx.http.put(`/v1/cart/items/${s.variant}`).set(bearer(buyer.token)).send({ quantity: 1 }).expect(200);
    await checkout(buyer).expect(201);
    await hooks.idle();
    expect(net.calls).toHaveLength(0);
  });

  it('emits for counter sales (once per sale, also on retry) and for visitor questions (id only)', async () => {
    reset();
    const s = await seller();
    await subscribe(s).expect(201);
    const clientId = randomUUID();
    const body = { clientId, paymentMethod: 'cash', lines: [{ variantId: s.variant, quantity: 3 }] };
    const sale = (await ctx.http.post(`/v1/orgs/${s.orgId}/pos/sales`).set(bearer(s.owner.token)).send(body).expect(201)).body;
    await ctx.http.post(`/v1/orgs/${s.orgId}/pos/sales`).set(bearer(s.owner.token)).send(body).expect(201);
    await hooks.idle();
    expect(net.calls).toHaveLength(1);
    expect(JSON.parse(net.calls[0]!.body)).toMatchObject({ event: 'pos.sale_created', data: { saleId: sale.id, totalMinor: 30_000, currency: 'CDF', paymentMethod: 'cash', lineCount: 1 } });
    expect(net.calls[0]!.body).not.toContain('Article');

    await ctx.http.post(`/v1/orgs/${s.orgId}/pos/sales/${sale.id}/void`).set(bearer(s.owner.token)).send({ reason: 'erreur de caisse' }).expect(200);
    await ctx.http.post(`/v1/orgs/${s.orgId}/pos/sales/${sale.id}/void`).set(bearer(s.owner.token)).send({}).expect(200);
    await hooks.idle();
    expect(net.calls).toHaveLength(2);
    expect(JSON.parse(net.calls[1]!.body)).toMatchObject({ event: 'pos.sale_voided', data: { saleId: sale.id, totalMinor: 30_000, currency: 'CDF' } });
    expect(net.calls[1]!.body).not.toContain('erreur de caisse');

    const visitor = await user();
    const q = (await ctx.http.post('/v1/me/org-questions').set(bearer(visitor.token)).send({ orgId: s.orgId, question: 'Question privée du visiteur ?' }).expect(201)).body;
    await hooks.idle();
    expect(net.calls).toHaveLength(3);
    const qBody = JSON.parse(net.calls[2]!.body);
    expect(qBody).toMatchObject({ event: 'org.question_asked', data: { questionId: q.id } });
    expect(Object.keys(qBody.data)).toEqual(['questionId']);
    expect(net.calls[2]!.body).not.toContain('privée');
    expect(net.calls[2]!.body).not.toContain(visitor.id);
  });

  it('never fails the originating operation, retries with backoff and gives up after 3 attempts', async () => {
    reset();
    net.respond = new Error('connection refused');
    const s = await seller();
    const h = (await subscribe(s, { events: ['order.created'] }).expect(201)).body;
    const buyer = await user();
    await ctx.http.put(`/v1/cart/items/${s.variant}`).set(bearer(buyer.token)).send({ quantity: 1 }).expect(200);
    await checkout(buyer).expect(201); // the order is created although the receiver is down
    await hooks.idle();

    let [d] = await deliveries(s, h.id);
    expect(d).toMatchObject({ status: 'pending', attempt: 1, httpStatus: null, errorCode: 'network' });
    const wait1 = new Date(d.nextAttemptAt).getTime() - Date.now();
    expect(wait1).toBeGreaterThan(30_000);
    expect(wait1).toBeLessThanOrEqual(60_000);
    expect(await hooks.processDue()).toBe(0); // not due yet

    net.respond = 503;
    await due();
    expect(await hooks.processDue()).toBe(1);
    [d] = await deliveries(s, h.id);
    expect(d).toMatchObject({ status: 'pending', attempt: 2, httpStatus: 503, errorCode: 'http' });
    const wait2 = new Date(d.nextAttemptAt).getTime() - Date.now();
    expect(wait2).toBeGreaterThan(9 * 60_000);
    expect(wait2).toBeLessThanOrEqual(10 * 60_000);

    await due();
    await hooks.processDue();
    [d] = await deliveries(s, h.id);
    expect(d).toMatchObject({ status: 'failed', attempt: 3, nextAttemptAt: null });
    await due();
    expect(await hooks.processDue()).toBe(0);
    // Three attempts of one delivery are one failure: only a delivery that gave up counts.
    expect((await hookOf(s, h.id)).failureCount).toBe(1);
  });

  it('a retry that succeeds delivers and resets the failure counter', async () => {
    reset();
    net.respond = 500;
    const s = await seller();
    const h = (await subscribe(s, { events: ['pos.sale_created'] }).expect(201)).body;
    await ctx.http.post(`/v1/orgs/${s.orgId}/pos/sales`).set(bearer(s.owner.token)).send({ clientId: randomUUID(), paymentMethod: 'cash', lines: [{ variantId: s.variant, quantity: 1 }] }).expect(201);
    await hooks.idle();
    expect((await hookOf(s, h.id)).failureCount).toBe(0); // a retry is still scheduled: not a failure yet
    net.respond = 204;
    await due();
    await hooks.processDue();
    expect((await deliveries(s, h.id))[0]).toMatchObject({ status: 'delivered', attempt: 2, httpStatus: 204 });
    expect(await hookOf(s, h.id)).toMatchObject({ failureCount: 0, lastStatus: 204 });
    // The signature of a retry covers its own timestamp and the same body.
    const [first, second] = net.calls;
    expect(second!.body).toBe(first!.body);
    expect(second!.headers['X-Caselind-Delivery']).toBe(first!.headers['X-Caselind-Delivery']);
    expect(second!.headers['X-Caselind-Signature']).toBe(signature(h.secret, second!.headers['X-Caselind-Timestamp']!, second!.body));
  });

  it('switches off after 10 consecutive failures, tells the owners, and can be switched back on', async () => {
    reset();
    net.respond = 500;
    const s = await seller();
    const h = (await subscribe(s, { events: ['pos.sale_created'] }).expect(201)).body;
    for (let i = 0; i < 10; i++) {
      hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
      await hooks.idle();
    }
    // Each delivery gives up after its third attempt; the tenth giving up switches the subscription off.
    for (let round = 0; round < 2; round++) {
      await due();
      await hooks.processDue();
    }
    const dead = await hookOf(s, h.id);
    expect(dead).toMatchObject({ active: false, failureCount: 10, lastStatus: 500 });
    expect(dead.disabledAt).toBeTruthy();
    const notes = (await ctx.http.get('/v1/notifications').set(bearer(s.owner.token)).expect(200)).body.items;
    const note = notes.find((x: { title: string }) => x.title === 'Webhook désactivé');
    expect(note).toBeTruthy();
    expect(JSON.stringify(note)).not.toContain('hooks.example.com');
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'org.webhook_disabled' AND metadata->>'webhookId' = $1`, [h.id]);
    expect(audit.rows).toHaveLength(1);

    const before = net.calls.length;
    hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
    await hooks.idle();
    expect(net.calls).toHaveLength(before);
    // Retries still waiting are dropped, not sent, once the subscription is off.
    await due();
    await hooks.processDue();
    expect(net.calls).toHaveLength(before);

    net.respond = 200;
    const revived = (await ctx.http.patch(`/v1/orgs/${s.orgId}/webhooks/${h.id}`).set(bearer(s.owner.token)).send({ active: true }).expect(200)).body;
    expect(revived).toMatchObject({ active: true, failureCount: 0, disabledAt: null });
    hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
    await hooks.idle();
    expect(net.calls).toHaveLength(before + 1);
  });

  it('refuses at send time an address that resolves to a private range (DNS rebinding) and connects to the verified one', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s, { events: ['pos.sale_created'] }).expect(201)).body;
    for (const bad of [['10.0.0.7'], ['93.184.216.34', '127.0.0.1'], ['::ffff:169.254.169.254'], ['fd00::1'], []]) {
      net.dns.set('hooks.example.com', bad);
      hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
      await hooks.idle();
    }
    expect(net.calls).toHaveLength(0);
    const log = await deliveries(s, h.id);
    expect(log).toHaveLength(5);
    expect(log.every((d: { errorCode: string; httpStatus: number | null }) => d.errorCode === 'blocked' && d.httpStatus === null)).toBe(true);

    net.dns.set('hooks.example.com', ['2606:2800:220:1:248:1893:25c8:1946', '93.184.216.34']);
    hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
    await hooks.idle();
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]!.address).toBe('2606:2800:220:1:248:1893:25c8:1946');
  });

  it('refuses at send time a stored URL that is no longer acceptable (production tightening)', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s, { url: 'http://localhost:4000/h', events: ['pos.sale_created'] }).expect(201)).body;
    hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
    await hooks.idle();
    expect(net.calls).toHaveLength(1); // dev loopback exception outside production
    const env = ctx.app.get<Env>(ENV);
    const saved = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
      await hooks.idle();
    } finally {
      env.NODE_ENV = saved;
    }
    expect(net.calls).toHaveLength(1);
    expect((await deliveries(s, h.id))[0]).toMatchObject({ errorCode: 'blocked' });
  });

  it('sends a ping on demand: no retry, no effect on the failure counter, throttled', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s).expect(201)).body;
    const ok = (await ctx.http.post(`/v1/orgs/${s.orgId}/webhooks/${h.id}/test`).set(bearer(s.owner.token)).expect(200)).body;
    expect(ok).toMatchObject({ event: 'ping', status: 'delivered', httpStatus: 200, attempt: 1 });
    expect(net.calls[0]!.headers['X-Caselind-Event']).toBe('ping');
    expect(JSON.parse(net.calls[0]!.body)).toMatchObject({ event: 'ping', orgId: s.orgId, data: { ping: true } });
    expect(net.calls[0]!.headers['X-Caselind-Signature']).toBe(signature(h.secret, net.calls[0]!.headers['X-Caselind-Timestamp']!, net.calls[0]!.body));

    net.respond = 500;
    const ko = (await ctx.http.post(`/v1/orgs/${s.orgId}/webhooks/${h.id}/test`).set(bearer(s.owner.token)).expect(200)).body;
    expect(ko).toMatchObject({ status: 'failed', httpStatus: 500, errorCode: 'http', nextAttemptAt: null });
    expect(await hookOf(s, h.id)).toMatchObject({ failureCount: 0, active: true });
    for (let i = 0; i < 3; i++) await ctx.http.post(`/v1/orgs/${s.orgId}/webhooks/${h.id}/test`).set(bearer(s.owner.token)).expect(200);
    const r = await ctx.http.post(`/v1/orgs/${s.orgId}/webhooks/${h.id}/test`).set(bearer(s.owner.token)).expect(409);
    expect(r.body.error.details).toMatchObject({ reason: 'rate_limited' });
  });
});

describe('journal', () => {
  it('keeps the 100 newest deliveries per webhook (maintenance) and lists the 50 latest without bodies', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s).expect(201)).body;
    await ctx.sql.query(
      `INSERT INTO org_webhook_deliveries (webhook_id, event, payload, payload_digest, status, http_status, attempt, created_at)
       SELECT $1, 'order.created', '{"secret":"BODY"}', 'x', 'delivered', 200, 1, now() - (g || ' minutes')::interval FROM generate_series(1, 130) g`,
      [h.id],
    );
    const list = await deliveries(s, h.id);
    expect(list).toHaveLength(50);
    expect(JSON.stringify(list)).not.toContain('BODY');
    await ctx.app.get(MaintenanceService).runOnce();
    expect((await ctx.sql.query('SELECT count(*)::int AS n FROM org_webhook_deliveries WHERE webhook_id = $1', [h.id])).rows[0].n).toBe(100);
    const oldest = await ctx.sql.query(`SELECT min(created_at) AS c FROM org_webhook_deliveries WHERE webhook_id = $1`, [h.id]);
    expect(Date.now() - new Date(oldest.rows[0].c).getTime()).toBeLessThan(101 * 60_000);
  });

  it('cascades with the organisation', async () => {
    const s = await seller();
    const h = (await subscribe(s).expect(201)).body;
    await ctx.http.post(`/v1/orgs/${s.orgId}/webhooks/${h.id}/test`).set(bearer(s.owner.token)).expect(200);
    await ctx.sql.query('DELETE FROM organizations WHERE id = $1', [s.orgId]);
    expect((await ctx.sql.query('SELECT count(*)::int AS n FROM org_webhooks WHERE id = $1', [h.id])).rows[0].n).toBe(0);
    expect((await ctx.sql.query('SELECT count(*)::int AS n FROM org_webhook_deliveries WHERE webhook_id = $1', [h.id])).rows[0].n).toBe(0);
  });
});

describe('review fixes: emission cap, key ids and secret errors', () => {
  const secretOf = (id: string) => ctx.sql.query('SELECT secret_enc FROM org_webhooks WHERE id = $1', [id]).then((r) => r.rows[0].secret_enc as string);

  it('drops the events of an organisation past the per-minute cap without failing anything', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s, { events: ['pos.sale_created'] }).expect(201)).body;
    const before = hooks.droppedEvents;
    for (let i = 0; i < WEBHOOK_EVENTS_PER_MINUTE + 5; i++) hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
    await hooks.idle();
    const sent = await ctx.sql.query('SELECT count(*)::int AS n FROM org_webhook_deliveries WHERE webhook_id = $1', [h.id]);
    expect(sent.rows[0].n).toBe(WEBHOOK_EVENTS_PER_MINUTE);
    expect(hooks.droppedEvents - before).toBe(5);
    // Another organisation is not affected.
    const t = await seller();
    const h2 = (await subscribe(t, { events: ['pos.sale_created'] }).expect(201)).body;
    hooks.emit(t.orgId, 'pos.sale_created', { saleId: randomUUID() });
    await hooks.idle();
    expect(await deliveries(t, h2.id)).toHaveLength(1);
  });

  it('still reads secrets sealed as v1 and carries a key id on new ones', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s, { events: ['pos.sale_created'] }).expect(201)).body;
    expect(await secretOf(h.id)).toMatch(/^v2:[0-9a-f]{8}:/);
    // Re-seal the secret the way v1 did (key derived from the JWT secret, no key id).
    const key = createHash('sha256').update('webhook-secret:').update(Buffer.from(ctx.app.get<Env>(ENV).JWT_ACCESS_SECRET)).digest();
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(Buffer.from(`webhook:${h.id}`));
    const ct = Buffer.concat([c.update('whsec_legacy', 'utf8'), c.final()]);
    const v1 = ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
    await ctx.sql.query('UPDATE org_webhooks SET secret_enc = $1 WHERE id = $2', [v1, h.id]);
    hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
    await hooks.idle();
    const call = net.calls[net.calls.length - 1]!;
    expect(call.headers['X-Caselind-Signature']).toBe(signature('whsec_legacy', call.headers['X-Caselind-Timestamp']!, call.body));
  });

  it('a secret that cannot be opened is a "secret" error, never counted against the subscription', async () => {
    reset();
    const s = await seller();
    const h = (await subscribe(s, { events: ['pos.sale_created'] }).expect(201)).body;
    await ctx.sql.query('UPDATE org_webhooks SET secret_enc = $1 WHERE id = $2', ['v2:00000000:AAAA:AAAA:AAAA', h.id]);
    for (let i = 0; i < 12; i++) {
      hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
      await hooks.idle();
    }
    for (let round = 0; round < 2; round++) {
      await due();
      await hooks.processDue();
    }
    const mine = async () => {
      const ids = (await deliveries(s, h.id)).map((d: { id: string }) => d.id);
      return net.calls.filter((c) => ids.includes(c.headers['X-Caselind-Delivery']!));
    };
    expect(await mine()).toHaveLength(0); // nothing was sent: the secret could not sign it
    expect(await hookOf(s, h.id)).toMatchObject({ active: true, failureCount: 0 });
    const list = await deliveries(s, h.id);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((d: { errorCode: string }) => d.errorCode === 'secret')).toBe(true);
    // Rotating the secret repairs it.
    await ctx.http.post(`/v1/orgs/${s.orgId}/webhooks/${h.id}/rotate-secret`).set(bearer(s.owner.token)).expect(200);
    hooks.emit(s.orgId, 'pos.sale_created', { saleId: randomUUID() });
    await hooks.idle();
    expect(await mine()).toHaveLength(1);
  });

  it('uses the dedicated key when set, keeps reading older secrets, and requires a key in production', () => {
    const base = ctx.app.get<Env>(ENV);
    const make = (env: Partial<Env>) => new WebhookService(null as never, { ...base, ...env } as Env, null as never, null as never);
    const hex = (c: string) => c.repeat(64);
    const old = make({ TOTP_ENCRYPTION_KEY: hex('a') }) as unknown as { seal(id: string, v: string): string; open(id: string, s: string): string };
    const next = make({ WEBHOOK_ENCRYPTION_KEY: hex('b'), TOTP_ENCRYPTION_KEY: hex('a') }) as unknown as typeof old;
    const sealedOld = old.seal('id1', 'whsec_x');
    const sealedNew = next.seal('id1', 'whsec_y');
    expect(sealedNew.split(':')[1]).not.toBe(sealedOld.split(':')[1]); // different key ids
    expect(next.open('id1', sealedOld)).toBe('whsec_x'); // old key kept as a fallback
    expect(next.open('id1', sealedNew)).toBe('whsec_y');
    expect(() => old.open('id1', sealedNew)).toThrow(); // the old config does not know the new key
    expect(() => make({ NODE_ENV: 'production', WEBHOOK_ENCRYPTION_KEY: undefined, TOTP_ENCRYPTION_KEY: undefined })).toThrow(/WEBHOOK_ENCRYPTION_KEY or TOTP_ENCRYPTION_KEY/);
    expect(() => make({ NODE_ENV: 'production', WEBHOOK_ENCRYPTION_KEY: hex('b'), TOTP_ENCRYPTION_KEY: undefined })).not.toThrow();
  });
});
