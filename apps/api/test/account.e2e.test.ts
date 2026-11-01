import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const DAY = 86_400_000;

/** Signs up a user and returns their identifier, tokens, id and handle. */
async function user() {
  const { identifier, tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { identifier, tokens, token: tokens.accessToken, id: me.body.id as string, handle: me.body.handle as string };
}

async function userRow(id: string) {
  const { rows } = await ctx.sql.query(
    `SELECT email, phone, status, handle, display_name, bio, avatar_url, password_hash, roles,
            deletion_requested_at, failed_login_count
       FROM users WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function auditCount(action: string, subject: string): Promise<number> {
  const { rows } = await ctx.sql.query<{ n: string }>(
    'SELECT count(*) AS n FROM audit_events WHERE action = $1 AND subject_user_id = $2',
    [action, subject],
  );
  return Number(rows[0]!.n);
}

describe('data export', () => {
  it('contains profile, privacy, sessions, blocks and security events, never secrets', async () => {
    const a = await user();
    const b = await user();
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.patch('/v1/me/privacy').set(bearer(a.token)).send({ readReceipts: false }).expect(200);
    // A second (then revoked) session so the export shows revoked sessions too.
    const second = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: a.identifier, password: PASSWORD })
      .expect(200);
    await ctx.http.post('/v1/auth/logout').set(bearer(second.body.accessToken)).expect(204);

    const res = await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200);
    const body = res.body;
    expect(Object.keys(body).sort()).toEqual(
      ['blocks', 'exportedAt', 'privacy', 'profile', 'securityEvents', 'sessions'].sort(),
    );
    expect(body.profile).toMatchObject({ id: a.id, handle: a.handle, email: a.identifier, status: 'active' });
    expect(body.privacy.readReceipts).toBe(false);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.find((s: { id: string }) => s.id === a.tokens.sessionId)).toMatchObject({
      platform: 'android',
      revokedAt: null,
    });
    expect(body.sessions.find((s: { id: string }) => s.id === second.body.sessionId).revokedAt).not.toBeNull();
    expect(body.blocks).toEqual([expect.objectContaining({ userId: b.id, handle: b.handle })]);
    const actions = body.securityEvents.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.register', 'auth.otp_verified', 'auth.login']));
    expect(Object.keys(body.securityEvents[0]).sort()).toEqual(['action', 'ip', 'occurredAt', 'userAgent']);

    const json = JSON.stringify(body);
    expect(json).not.toContain('argon2');
    expect(json).not.toContain(a.tokens.refreshToken);
    expect(json).not.toContain(second.body.refreshToken);
    expect(json).not.toContain('code_hash');
    expect(json).not.toContain('codeHash');
    expect(json).not.toContain('token_hash');
    expect(json).not.toContain('passwordHash');

    expect(await auditCount('user.data_exported', a.id)).toBe(1);
  });

  it('requires authentication', async () => {
    await ctx.http.get('/v1/me/export').expect(401);
  });
});

describe('account deletion', () => {
  it('rejects a wrong password with 401 and changes nothing', async () => {
    const a = await user();
    const res = await ctx.http
      .post('/v1/me/deletion-request')
      .set(bearer(a.token))
      .send({ password: 'wrong-password-123' })
      .expect(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    await ctx.http.post('/v1/me/deletion-request').set(bearer(a.token)).send({}).expect(400);

    const row = await userRow(a.id);
    expect(row.deletion_requested_at).toBeNull();
    expect(row.failed_login_count).toBe(0);
    await ctx.http.get('/v1/me').set(bearer(a.token)).expect(200);
    expect(await auditCount('user.deletion_requested', a.id)).toBe(0);
  });

  it('schedules the deletion, revokes every session and hides the profile; login in grace cancels', async () => {
    const a = await user();
    const viewer = await user();
    const other = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: a.identifier, password: PASSWORD })
      .expect(200);

    const before = Date.now();
    const res = await ctx.http
      .post('/v1/me/deletion-request')
      .set(bearer(a.token))
      .send({ password: PASSWORD })
      .expect(202);
    const scheduled = new Date(res.body.deletionScheduledFor).getTime();
    expect(scheduled).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    expect(scheduled).toBeLessThanOrEqual(Date.now() + 30 * DAY + 1000);

    await ctx.http.get('/v1/me').set(bearer(a.token)).expect(401);
    await ctx.http.get('/v1/me').set(bearer(other.body.accessToken)).expect(401);
    await ctx.http.post('/v1/auth/refresh').send({ refreshToken: a.tokens.refreshToken }).expect(401);
    const { rows: live } = await ctx.sql.query(
      'SELECT revoke_reason FROM sessions WHERE user_id = $1',
      [a.id],
    );
    expect(live.map((r) => r.revoke_reason)).toEqual(['account_deletion_requested', 'account_deletion_requested']);
    expect((await userRow(a.id)).deletion_requested_at).not.toBeNull();
    expect(await auditCount('user.deletion_requested', a.id)).toBe(1);
    await ctx.http.get(`/v1/users/${a.handle}`).set(bearer(viewer.token)).expect(404);

    // Signing in again during the grace period cancels the request.
    const login = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: a.identifier, password: PASSWORD })
      .expect(200);
    expect(login.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect((await userRow(a.id)).deletion_requested_at).toBeNull();
    expect(await auditCount('auth.deletion_cancelled', a.id)).toBe(1);
    await ctx.http.get(`/v1/users/${a.handle}`).set(bearer(viewer.token)).expect(200);
    await ctx.http.get('/v1/me').set(bearer(login.body.accessToken)).expect(200);
  });

  it('refuses login once the grace period is over, even before the purge ran', async () => {
    const a = await user();
    await ctx.http.post('/v1/me/deletion-request').set(bearer(a.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [a.id]);
    const res = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: a.identifier, password: PASSWORD })
      .expect(403);
    expect(res.body.error.code).toBe('account_suspended');
    expect((await userRow(a.id)).deletion_requested_at).not.toBeNull();
  });

  it('purges due deletions: anonymises the account, frees the e-mail, keeps the audit log', async () => {
    const a = await user();
    const b = await user();
    const pending = await user(); // still inside its grace period: must not be purged
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.put(`/v1/blocks/${a.id}`).set(bearer(b.token)).expect(204);
    await ctx.http.post('/v1/me/deletion-request').set(bearer(a.token)).send({ password: PASSWORD }).expect(202);
    await ctx.http
      .post('/v1/me/deletion-request')
      .set(bearer(pending.token))
      .send({ password: PASSWORD })
      .expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [a.id]);
    const eventsBefore = Number(
      (await ctx.sql.query('SELECT count(*) AS n FROM audit_events WHERE subject_user_id = $1', [a.id])).rows[0].n,
    );

    const service = ctx.app.get(MaintenanceService);
    const result = await service.runOnce();
    expect(result.deletedAccounts).toBeGreaterThanOrEqual(1);

    const row = await userRow(a.id);
    expect(row).toMatchObject({
      email: null,
      phone: null,
      status: 'deleted',
      display_name: 'Compte supprimé',
      bio: null,
      avatar_url: null,
      roles: ['user'],
    });
    expect(row.handle).toMatch(/^deleted_[0-9a-f]{12}$/);
    expect(row.password_hash).not.toContain('argon2');
    const count = async (q: string) => Number((await ctx.sql.query(q, [a.id])).rows[0].n);
    expect(await count('SELECT count(*) AS n FROM sessions WHERE user_id = $1')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM otp_challenges WHERE user_id = $1')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM audit_events WHERE subject_user_id = $1')).toBe(eventsBefore + 1);
    expect(await auditCount('user.deleted', a.id)).toBe(1);

    // The other pending account is untouched.
    expect((await userRow(pending.id)).status).toBe('active');

    // The old identifier no longer signs in, and can be registered again.
    const login = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: a.identifier, password: PASSWORD })
      .expect(401);
    expect(login.body.error.code).toBe('invalid_credentials');
    const again = await signUp(ctx, a.identifier);
    const me = await ctx.http.get('/v1/me').set(bearer(again.tokens.accessToken)).expect(200);
    expect(me.body.id).not.toBe(a.id);
    expect(me.body.email).toBe(a.identifier);

    // Idempotent: nothing more to purge for this account.
    await service.runOnce();
    expect(await auditCount('user.deleted', a.id)).toBe(1);
  });
});
