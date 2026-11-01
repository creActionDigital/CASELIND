import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrator.js';
import { createTestContext, PASSWORD, type TestContext, uniqueEmail } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
});
afterAll(async () => {
  await ctx.close();
});

describe('platform', () => {
  it('health reports the database as reachable, without authentication', async () => {
    const res = await ctx.http.get('/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('sets security headers and a request id, and hides the framework', async () => {
    const res = await ctx.http.get('/v1/health').set('x-request-id', 'trace-abc-12345');
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('unknown routes return the error envelope', async () => {
    const res = await ctx.http.get('/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('rate-limits auth endpoints (429 rate_limited) while other routes keep working', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await ctx.http.post('/v1/auth/login').send({ identifier: uniqueEmail(), password: PASSWORD });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    await ctx.http.get('/v1/health').expect(200);
  });

  it('the audit log is append-only at the database level', async () => {
    await ctx.sql.query(`INSERT INTO audit_events (action) VALUES ('test.event')`);
    await expect(ctx.sql.query(`UPDATE audit_events SET action = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
  });

  it('migrations are idempotent and protected against later edits', async () => {
    const again = await migrate(ctx.databaseUrl);
    expect(again.applied).toEqual([]);
    expect(again.skipped).toContain('0001_identity.sql');

    await ctx.sql.query(`UPDATE schema_migrations SET checksum = 'edited' WHERE name = '0001_identity.sql'`);
    await expect(migrate(ctx.databaseUrl)).rejects.toThrow(/checksum mismatch/);
  });

  it('database constraints reject invalid data even if application checks were bypassed', async () => {
    await expect(
      ctx.sql.query(`INSERT INTO users (password_hash, handle, display_name) VALUES ('x', 'no_identifier', 'X')`),
    ).rejects.toThrow(/users_identifier_required/);
    await expect(
      ctx.sql.query(
        `INSERT INTO users (email, password_hash, handle, display_name, roles)
         VALUES ('r@example.test', 'x', 'roley', 'X', ARRAY['superuser'])`,
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
