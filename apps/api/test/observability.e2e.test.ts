import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countMaintenanceRun, countPosOperation, countWebhookDelivery, renderMetrics } from '../src/observability/metrics.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

const TOKEN = 'metrics-token-0123456789abcdef';
const UUID = '8f14e45f-ceea-467f-a8b9-2c5c1f5f1a11';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request id (cahier §29)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('generates a uuid when none is sent, and echoes a valid incoming one', async () => {
    const generated = await ctx.http.get('/v1/health').expect(200);
    expect(generated.headers['x-request-id']).toMatch(UUID_RE);
    const echoed = await ctx.http.get('/v1/health').set('x-request-id', 'Trace_1.a-b').expect(200);
    expect(echoed.headers['x-request-id']).toBe('Trace_1.a-b');
  });

  it('replaces an invalid incoming id (bad characters, over 64 chars)', async () => {
    for (const bad of ['has space', 'semi;colon', 'x'.repeat(65), 'abc']) {
      const res = await ctx.http.get('/v1/health').set('x-request-id', bad).expect(200);
      expect(res.headers['x-request-id']).toMatch(UUID_RE);
    }
  });

  it('puts the same id in the error envelope', async () => {
    const res = await ctx.http.get('/v1/me').set('x-request-id', 'err-corr-1').expect(401);
    expect(res.headers['x-request-id']).toBe('err-corr-1');
    expect(res.body.error.requestId).toBe('err-corr-1');
    expect(res.body.error.code).toBe('unauthenticated');
  });
});

describe('health probes', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('live answers without the database, ready checks database and migrations, health is unchanged', async () => {
    expect((await ctx.http.get('/v1/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await ctx.http.get('/v1/health/ready').expect(200)).body).toEqual({ status: 'ok', db: 'ok', migrations: 'ok' });
    expect((await ctx.http.get('/v1/health').expect(200)).body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('ready is 503 while the latest migration is not recorded', async () => {
    const { rows } = await ctx.sql.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1');
    await ctx.sql.query('ALTER TABLE schema_migrations RENAME TO schema_migrations_x');
    try {
      const res = await ctx.http.get('/v1/health/ready').expect(503);
      expect(res.body.error.message).toBe('Migrations pending');
      await ctx.http.get('/v1/health/live').expect(200);
    } finally {
      await ctx.sql.query('ALTER TABLE schema_migrations_x RENAME TO schema_migrations');
    }
    expect(rows[0]?.name).toMatch(/\.sql$/);
  });
});

describe('GET /metrics', () => {
  let ctx: TestContext;
  let off: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ METRICS_TOKEN: TOKEN });
    off = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
    await off.close();
  });

  it('is 404 without a configured token, outside the /v1 prefix', async () => {
    await off.http.get('/metrics').expect(404);
    await off.http.get('/metrics').set(bearer(TOKEN)).expect(404);
    await ctx.http.get('/v1/metrics').expect(404);
  });

  it('is 401 without or with a wrong token (same length included)', async () => {
    await ctx.http.get('/metrics').expect(401);
    await ctx.http.get('/metrics').set(bearer('wrong')).expect(401);
    await ctx.http.get('/metrics').set(bearer(`${TOKEN.slice(0, -1)}x`)).expect(401);
  });

  it('serves Prometheus text with templated routes only (no identifier in labels)', async () => {
    const { tokens } = await signUp(ctx);
    await ctx.http.get(`/v1/orders/${UUID}`).set(bearer(tokens.accessToken));
    await ctx.http.get('/v1/health').expect(200);
    await ctx.http.get('/v1/zzz-secret-path-4242').expect(404);

    const res = await ctx.http.get('/metrics').set(bearer(TOKEN)).expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const text = res.text;
    expect(text).toMatch(/^# TYPE http_requests_total counter$/m);
    expect(text).toMatch(/^http_requests_total\{method="GET",route="\/v1\/health",status_class="2xx"\} \d+$/m);
    expect(text).toMatch(/^http_requests_total\{method="GET",route="\/v1\/orders\/:id",status_class="[24]xx"\} \d+$/m);
    expect(text).toMatch(/^http_requests_total\{method="GET",route="unmatched",status_class="4xx"\} \d+$/m);
    expect(text).toMatch(/^http_request_duration_seconds_bucket\{method="GET",route="\/v1\/health",le="\+Inf"\} \d+$/m);
    expect(text).toMatch(/^# TYPE http_request_duration_seconds histogram$/m);
    for (const name of [
      'process_resident_memory_bytes',
      'process_cpu_seconds_total',
      'nodejs_eventloop_lag_p99_seconds',
      'pg_pool_connections_total',
      'pg_pool_connections_idle',
      'pg_pool_waiting_requests',
      'socketio_connections_active',
    ]) {
      expect(text).toMatch(new RegExp(`^${name} [0-9.e+-]+$`, 'm'));
    }
    expect(text).not.toContain(UUID);
    expect(text).not.toContain('zzz-secret-path');
    // Every sample line is `name{labels} number`.
    for (const line of text.trim().split('\n')) {
      expect(line).toMatch(/^(#.*|[a-z0-9_:]+(\{[^}]*\})? -?[0-9.e+-]+)$/);
    }
  });

  it('exposes webhook, maintenance and cash-register counters by outcome', () => {
    countWebhookDelivery('retry');
    countMaintenanceRun('failure');
    countPosOperation('sale');
    const text = renderMetrics();
    expect(text).toContain('caselind_webhook_deliveries_total{status="retry"} ');
    expect(text).toContain('caselind_maintenance_runs_total{result="failure"} ');
    expect(text).toContain('caselind_pos_operations_total{type="sale"} ');
  });
});
