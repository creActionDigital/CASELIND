import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagsService } from '../src/flags/flags.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
let adminToken: string;
let adminId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const admin = await signUp(ctx);
  await ctx.sql.query(`UPDATE users SET roles = ARRAY['user','admin'] WHERE email = $1`, [admin.identifier]);
  adminToken = admin.tokens.accessToken;
  adminId = (await ctx.http.get('/v1/me').set(bearer(adminToken)).expect(200)).body.id;
});
afterAll(async () => {
  await ctx.close();
});

/** Signs up a user and sets their country directly in the database. */
async function userIn(country: string | null): Promise<string> {
  const u = await signUp(ctx);
  await ctx.sql.query(`UPDATE users SET country = $1 WHERE email = $2`, [country, u.identifier]);
  return u.tokens.accessToken;
}

const flagsOf = async (token: string) =>
  (await ctx.http.get('/v1/config/flags').set(bearer(token)).expect(200)).body.flags as Record<string, boolean>;

describe('GET /v1/config/flags', () => {
  it('requires authentication', async () => {
    await ctx.http.get('/v1/config/flags').expect(401);
  });

  it('returns the seeded flags evaluated for the user: regulated modules are off', async () => {
    const flags = await flagsOf(await userIn('CD'));
    expect(flags).toMatchObject({
      messaging: true,
      'social.stories': true,
      betting: false,
      'wallet.real_money': false,
      'health.prescriptions': false,
    });
    expect(Object.values(flags).every((v) => typeof v === 'boolean')).toBe(true);
  });

  it('restricts a flag by country (a user without country is excluded)', async () => {
    const cd = await userIn('CD');
    const ke = await userIn('KE');
    const none = await userIn(null);

    await ctx.http
      .put('/v1/admin/flags/social.stories')
      .set(bearer(adminToken))
      .send({ allowedCountries: ['CD'] })
      .expect(200);

    expect((await flagsOf(cd))['social.stories']).toBe(true);
    expect((await flagsOf(ke))['social.stories']).toBe(false);
    expect((await flagsOf(none))['social.stories']).toBe(false);

    await ctx.http
      .put('/v1/admin/flags/social.stories')
      .set(bearer(adminToken))
      .send({ allowedCountries: null })
      .expect(200);
    expect((await flagsOf(ke))['social.stories']).toBe(true);
  });

  it('restricts a flag by role (read from the database)', async () => {
    const user = await userIn('CD');
    const res = await ctx.http
      .put('/v1/admin/flags/messaging')
      .set(bearer(adminToken))
      .send({ allowedRoles: ['moderator', 'admin'] })
      .expect(200);
    expect(res.body).toMatchObject({ key: 'messaging', allowedRoles: ['moderator', 'admin'], updatedBy: adminId });

    expect((await flagsOf(user)).messaging).toBe(false);
    expect((await flagsOf(adminToken)).messaging).toBe(true);

    await ctx.http.put('/v1/admin/flags/messaging').set(bearer(adminToken)).send({ allowedRoles: null }).expect(200);
    expect((await flagsOf(user)).messaging).toBe(true);
  });

  it('evaluates an unknown key to false', async () => {
    const flags = ctx.app.get(FlagsService);
    expect(await flags.evaluate('does.not.exist', { country: 'CD', roles: ['user', 'admin'] })).toBe(false);
    expect(await flags.evaluate('messaging', { country: 'CD', roles: ['user'] })).toBe(true);
  });
});

describe('admin flags', () => {
  it('is refused to non-admins', async () => {
    const user = await userIn('CD');
    await ctx.http.get('/v1/admin/flags').set(bearer(user)).expect(403);
    await ctx.http.put('/v1/admin/flags/messaging').set(bearer(user)).send({ enabled: false }).expect(403);
  });

  it('lists every flag with its restrictions', async () => {
    const res = await ctx.http.get('/v1/admin/flags').set(bearer(adminToken)).expect(200);
    const betting = res.body.items.find((f: { key: string }) => f.key === 'betting');
    expect(betting).toMatchObject({ enabled: false, regulated: true, allowedCountries: null, allowedRoles: null });
    expect(res.body.items.length).toBeGreaterThanOrEqual(10);
  });

  it('requires confirmRegulated to enable a regulated flag, and audits the change', async () => {
    const conflict = await ctx.http
      .put('/v1/admin/flags/betting')
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(409);
    expect(conflict.body.error).toMatchObject({ code: 'conflict', details: { regulated: true } });
    const still = await ctx.sql.query(`SELECT enabled FROM feature_flags WHERE key = 'betting'`);
    expect(still.rows[0].enabled).toBe(false);

    const res = await ctx.http
      .put('/v1/admin/flags/betting')
      .set(bearer(adminToken))
      .send({ enabled: true, allowedCountries: ['CD'], confirmRegulated: true })
      .expect(200);
    expect(res.body).toMatchObject({ key: 'betting', enabled: true, allowedCountries: ['CD'] });
    expect((await flagsOf(await userIn('CD'))).betting).toBe(true);
    expect((await flagsOf(await userIn('KE'))).betting).toBe(false);

    const audit = await ctx.sql.query(
      `SELECT actor_user_id, metadata FROM audit_events WHERE action = 'admin.flag_updated' AND metadata->>'key' = 'betting'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_user_id).toBe(adminId);
    expect(audit.rows[0].metadata).toMatchObject({
      key: 'betting',
      confirmedRegulated: true,
      changes: { enabled: { from: false, to: true }, allowedCountries: { from: null, to: ['CD'] } },
    });

    // Switching it back off needs no confirmation.
    await ctx.http.put('/v1/admin/flags/betting').set(bearer(adminToken)).send({ enabled: false }).expect(200);
  });

  it('requires confirmRegulated to change the reach of a regulated flag that is already on', async () => {
    await ctx.http
      .put('/v1/admin/flags/trading.live')
      .set(bearer(adminToken))
      .send({ enabled: true, allowedCountries: ['CD'], confirmRegulated: true })
      .expect(200);

    // Widening the countries without confirmation is refused and leaves the flag untouched.
    const conflict = await ctx.http
      .put('/v1/admin/flags/trading.live')
      .set(bearer(adminToken))
      .send({ allowedCountries: ['CD', 'KE'] })
      .expect(409);
    expect(conflict.body.error).toMatchObject({ code: 'conflict', details: { regulated: true } });
    await ctx.http
      .put('/v1/admin/flags/trading.live')
      .set(bearer(adminToken))
      .send({ allowedCountries: null })
      .expect(409);
    await ctx.http
      .put('/v1/admin/flags/trading.live')
      .set(bearer(adminToken))
      .send({ allowedRoles: ['user'] })
      .expect(409);
    const unchanged = await ctx.sql.query(
      `SELECT enabled, allowed_countries, allowed_roles FROM feature_flags WHERE key = 'trading.live'`,
    );
    expect(unchanged.rows[0]).toMatchObject({ enabled: true, allowed_roles: null });
    expect(unchanged.rows[0].allowed_countries).toEqual(['CD']);
    expect((await flagsOf(await userIn('KE')))['trading.live']).toBe(false);

    // With confirmation the change goes through.
    const res = await ctx.http
      .put('/v1/admin/flags/trading.live')
      .set(bearer(adminToken))
      .send({ allowedCountries: ['CD', 'KE'], confirmRegulated: true })
      .expect(200);
    expect(res.body).toMatchObject({ enabled: true, allowedCountries: ['CD', 'KE'] });
    expect((await flagsOf(await userIn('KE')))['trading.live']).toBe(true);

    // Description edits and switching off need no confirmation.
    await ctx.http
      .put('/v1/admin/flags/trading.live')
      .set(bearer(adminToken))
      .send({ description: 'Trading en direct (CDC §26)' })
      .expect(200);
    await ctx.http.put('/v1/admin/flags/trading.live').set(bearer(adminToken)).send({ enabled: false }).expect(200);
    // Restricting reach while off needs no confirmation either: it stays off.
    await ctx.http
      .put('/v1/admin/flags/trading.live')
      .set(bearer(adminToken))
      .send({ allowedCountries: ['KE'] })
      .expect(200);
  });

  it('returns 404 for an unknown key and 400 for invalid input', async () => {
    const res = await ctx.http
      .put('/v1/admin/flags/does.not.exist')
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(404);
    expect(res.body.error.code).toBe('not_found');

    await ctx.http.put('/v1/admin/flags/messaging').set(bearer(adminToken)).send({}).expect(400);
    await ctx.http
      .put('/v1/admin/flags/messaging')
      .set(bearer(adminToken))
      .send({ allowedCountries: ['cd'] })
      .expect(400);
    await ctx.http
      .put('/v1/admin/flags/messaging')
      .set(bearer(adminToken))
      .send({ allowedRoles: ['superuser'] })
      .expect(400);
    await ctx.http.put('/v1/admin/flags/Bad-Key').set(bearer(adminToken)).send({ enabled: true }).expect(400);
  });
});

describe('admin flag update under concurrency', () => {
  /** Backends of this test database currently blocked on a lock. */
  async function lockWaiters(): Promise<number> {
    const { rows } = await ctx.sql.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    return rows[0].n;
  }
  async function waitForLockWaiters(n: number): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if ((await lockWaiters()) >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out waiting for ${n} lock waiter(s)`);
  }

  it('re-evaluates the regulated check against the committed state (no lost confirmation)', async () => {
    // Deterministic interleaving: the test holds the flag row lock, request A (confirmed enable)
    // queues on it first, request B (widen reach, unconfirmed) queues second, then the lock is
    // released. Postgres grants row-lock waiters in order, so A commits before B decides. With
    // the read/decision/write in one locked transaction, B must see the flag ON and get 409.
    // (Without it, B's decision used the stale OFF read and widened an enabled regulated flag.)
    const holder = await ctx.sql.connect();
    let a: Promise<{ status: number }> | undefined;
    let b: Promise<{ status: number }> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM feature_flags WHERE key = 'wallet.real_money' FOR UPDATE`);

      a = ctx.http
        .put('/v1/admin/flags/wallet.real_money')
        .set(bearer(adminToken))
        .send({ enabled: true, confirmRegulated: true })
        .then((r) => r);
      await waitForLockWaiters(1);
      b = ctx.http
        .put('/v1/admin/flags/wallet.real_money')
        .set(bearer(adminToken))
        .send({ allowedCountries: ['CD', 'KE'] })
        .then((r) => r);
      await waitForLockWaiters(2);
    } finally {
      await holder.query('COMMIT');
      holder.release();
    }
    const [ra, rb] = await Promise.all([a!, b!]);

    expect(ra.status).toBe(200);
    expect(rb.status).toBe(409);
    const flag = await ctx.sql.query(
      `SELECT enabled, allowed_countries FROM feature_flags WHERE key = 'wallet.real_money'`,
    );
    expect(flag.rows[0]).toEqual({ enabled: true, allowed_countries: null });

    // Exactly one audited change, confirmed, whose "from" is the state it actually replaced.
    const audit = await ctx.sql.query(
      `SELECT metadata FROM audit_events WHERE action = 'admin.flag_updated' AND metadata->>'key' = 'wallet.real_money'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toEqual({
      key: 'wallet.real_money',
      confirmedRegulated: true,
      changes: { enabled: { from: false, to: true } },
    });

    await ctx.http.put('/v1/admin/flags/wallet.real_money').set(bearer(adminToken)).send({ enabled: false }).expect(200);
  });
});
