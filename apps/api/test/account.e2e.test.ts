import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV } from '../src/config/env.js';
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

/** A real 1x1 PNG. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Announces and uploads a PNG; returns the ready asset id. */
async function uploadPng(token: string, purpose = 'avatar'): Promise<string> {
  const up = await ctx.http
    .post('/v1/media/uploads')
    .set(bearer(token))
    .send({ purpose, mime: 'image/png', sizeBytes: TINY_PNG.length })
    .expect(201);
  await ctx.http
    .put(up.body.uploadUrl)
    .set(bearer(token))
    .set('X-Upload-Token', up.body.uploadToken)
    .set('Content-Type', 'application/octet-stream')
    .send(TINY_PNG)
    .expect(200);
  return up.body.assetId as string;
}

const objectPath = (id: string) =>
  join(ctx.app.get(ENV).MEDIA_STORAGE_DIR, 'objects', 'media', id.slice(0, 2), id);

let slugCounter = 0;
async function createOrg(token: string): Promise<{ id: string; slug: string; name: string }> {
  const slug = `acct-${Date.now().toString(36)}-${++slugCounter}`;
  const res = await ctx.http.post('/v1/orgs').set(bearer(token)).send({ slug, name: `Org ${slug}`, kind: 'shop' }).expect(201);
  return { id: res.body.id, slug: res.body.slug, name: res.body.name };
}

/** `inviterToken` invites `invitee` with `role`; the invitee accepts. */
async function addMember(orgId: string, inviterToken: string, invitee: { token: string; handle: string }, role: string) {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(inviterToken)).send({ handle: invitee.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(invitee.token)).expect(200);
}

const requestDeletion = (token: string) =>
  ctx.http.post('/v1/me/deletion-request').set(bearer(token)).send({ password: PASSWORD });

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
    // One owned org, one membership elsewhere, one pending invitation; one ready + one pending upload.
    const owned = await createOrg(a.token);
    const inviter = await user(); // not b: a blocked b, so b's invitation would be a 404
    const theirs = await createOrg(inviter.token);
    await addMember(theirs.id, inviter.token, a, 'sales');
    const invitedTo = await createOrg(inviter.token);
    await ctx.http.post(`/v1/orgs/${invitedTo.id}/invitations`).set(bearer(inviter.token)).send({ handle: a.handle, role: 'stock' }).expect(201);
    const assetId = await uploadPng(a.token);
    const pendingUpload = await ctx.http
      .post('/v1/media/uploads')
      .set(bearer(a.token))
      .send({ purpose: 'post', mime: 'image/png', sizeBytes: 10 })
      .expect(201);

    const res = await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200);
    const body = res.body;
    expect(Object.keys(body).sort()).toEqual(
      ['aiConversations', 'blocks', 'budgets', 'cart', 'comments', 'conversations', 'deliveries', 'education', 'exportedAt', 'favoriteMessages', 'following', 'freelance', 'games', 'health', 'jobAlerts', 'jobApplications', 'jobInterviews', 'jobProfile', 'kyc', 'listingAlerts', 'listingVisits', 'listings', 'media', 'messagesSent', 'messagesSentTruncated', 'miniappGrants', 'mobility', 'orders', 'orgMemberships', 'posts', 'privacy', 'profile', 'reportsFiled', 'reviews', 'school', 'searchHistory', 'securityEvents', 'services', 'sessions', 'stories', 'twoFactorEnabled', 'twoFactorEnabledAt', 'wallet'].sort(),
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

    expect(body.orgMemberships).toHaveLength(3);
    expect(body.orgMemberships).toEqual(
      expect.arrayContaining([
        { orgId: owned.id, slug: owned.slug, name: owned.name, role: 'owner', status: 'active', joinedAt: expect.any(String) },
        { orgId: theirs.id, slug: theirs.slug, name: theirs.name, role: 'sales', status: 'active', joinedAt: expect.any(String) },
        { orgId: invitedTo.id, slug: invitedTo.slug, name: invitedTo.name, role: 'stock', status: 'invited', joinedAt: null },
      ]),
    );
    expect(body.media).toEqual([
      {
        id: assetId,
        purpose: 'avatar',
        mime: 'image/png',
        sizeBytes: TINY_PNG.length,
        status: 'ready',
        contentUrl: `/v1/media/${assetId}/content`,
        createdAt: expect.any(String),
      },
      {
        id: pendingUpload.body.assetId,
        purpose: 'post',
        mime: null,
        sizeBytes: 10,
        status: 'pending',
        contentUrl: null,
        createdAt: expect.any(String),
      },
    ]);

    const json = JSON.stringify(body);
    expect(json).not.toContain('argon2');
    expect(json).not.toContain(a.tokens.refreshToken);
    expect(json).not.toContain(second.body.refreshToken);
    expect(json).not.toContain('code_hash');
    expect(json).not.toContain('codeHash');
    expect(json).not.toContain('token_hash');
    expect(json).not.toContain('passwordHash');
    // Storage location and checksum of uploads stay internal.
    expect(json).not.toContain('storage_key');
    expect(json).not.toContain('storageKey');
    expect(json).not.toContain(`media/${assetId.slice(0, 2)}/`);
    expect(json).not.toContain('sha256');
    expect(json).not.toContain('uploadToken');

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

describe('account deletion and organisations', () => {
  it('refuses (409 last_owner) while the caller is the last active owner; OK once another owner exists', async () => {
    const a = await user();
    const b = await user();
    const org = await createOrg(a.token);
    const other = await createOrg(b.token);
    await addMember(other.id, b.token, a, 'admin'); // not an owner there: does not block

    const res = await requestDeletion(a.token).expect(409);
    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.details).toEqual({ reason: 'last_owner', orgs: [{ id: org.id, slug: org.slug, name: org.name }] });
    // Nothing changed.
    expect((await userRow(a.id)).deletion_requested_at).toBeNull();
    await ctx.http.get('/v1/me').set(bearer(a.token)).expect(200);
    expect(await auditCount('user.deletion_requested', a.id)).toBe(0);

    // A pending owner invitation does not count.
    await ctx.http.post(`/v1/orgs/${org.id}/invitations`).set(bearer(a.token)).send({ handle: b.handle, role: 'owner' }).expect(201);
    await requestDeletion(a.token).expect(409);

    // Once b accepted (second active owner), the request goes through.
    await ctx.http.post(`/v1/me/org-invitations/${org.id}/accept`).set(bearer(b.token)).expect(200);
    await requestDeletion(a.token).expect(202);

    // b can no longer leave: an owner with a pending deletion does not count as another owner.
    const leave = await ctx.http.delete(`/v1/orgs/${org.id}/members/${b.id}`).set(bearer(b.token)).expect(409);
    expect(leave.body.error.details).toMatchObject({ reason: 'last_owner' });
  });

  it('allows the deletion after ownership was transferred, and ignores suspended orgs', async () => {
    const a = await user();
    const b = await user();
    const org = await createOrg(a.token);
    await addMember(org.id, a.token, b, 'manager');
    await requestDeletion(a.token).expect(409);
    await ctx.http.patch(`/v1/orgs/${org.id}/members/${b.id}`).set(bearer(a.token)).send({ role: 'owner' }).expect(200);
    await ctx.http.patch(`/v1/orgs/${org.id}/members/${a.id}`).set(bearer(b.token)).send({ role: 'admin' }).expect(200);

    // Suspended org: ownership cannot be transferred there, so it never blocks.
    const suspended = await createOrg(a.token);
    await ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [suspended.id]);
    await requestDeletion(a.token).expect(202);
  });

  it('purge removes memberships, media rows and files, and suspends an org left without an owner', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const shared = await createOrg(b.token); // b stays owner: untouched
    await addMember(shared.id, b.token, a, 'admin');
    const inviting = await createOrg(c.token); // pending invitation for a
    await ctx.http.post(`/v1/orgs/${inviting.id}/invitations`).set(bearer(c.token)).send({ handle: a.handle, role: 'sales' }).expect(201);
    // Orphan edge case: a is the only owner of `solo`. The deletion request would be refused
    // (rule 1), so the due deletion is set up with direct SQL.
    const solo = await createOrg(a.token);
    await addMember(solo.id, a.token, c, 'employee');
    const avatar = await uploadPng(a.token);
    await ctx.http.patch('/v1/me/avatar').set(bearer(a.token)).send({ assetId: avatar }).expect(200);
    await ctx.sql.query('UPDATE organizations SET logo_url = $1 WHERE id = $2', [`/v1/media/${avatar}/content`, solo.id]);
    await ctx.http.post('/v1/media/uploads').set(bearer(a.token)).send({ purpose: 'post', mime: 'image/png', sizeBytes: 10 }).expect(201);
    const kept = await uploadPng(b.token);
    expect(existsSync(objectPath(avatar))).toBe(true);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [a.id]);

    const service = ctx.app.get(MaintenanceService);
    const result = await service.runOnce();
    expect(result.deletedAccounts).toBe(1);
    expect(result.deletedUserMedia).toBe(2);

    const n = async (q: string, params: unknown[]) => Number((await ctx.sql.query(q, params)).rows[0].n);
    expect(await n('SELECT count(*) AS n FROM org_members WHERE user_id = $1', [a.id])).toBe(0);
    expect(await n('SELECT count(*) AS n FROM media_assets WHERE owner_user_id = $1', [a.id])).toBe(0);
    expect(existsSync(objectPath(avatar))).toBe(false);
    expect(existsSync(objectPath(kept))).toBe(true);
    await ctx.http.get(`/v1/media/${avatar}`).set(bearer(c.token)).expect(404);

    const orgRow = async (id: string) =>
      (await ctx.sql.query('SELECT status, logo_url FROM organizations WHERE id = $1', [id])).rows[0];
    expect(await orgRow(shared.id)).toMatchObject({ status: 'active' });
    expect(await orgRow(inviting.id)).toMatchObject({ status: 'active' });
    expect(await orgRow(solo.id)).toEqual({ status: 'suspended', logo_url: null });
    const { rows: events } = await ctx.sql.query(
      `SELECT subject_user_id, actor_user_id, metadata FROM audit_events WHERE action = 'org.suspended_orphaned'`,
    );
    expect(events).toEqual([
      { subject_user_id: a.id, actor_user_id: null, metadata: expect.objectContaining({ orgId: solo.id, previousStatus: 'active' }) },
    ]);
    // The remaining member of the suspended org can still leave it.
    await ctx.http.delete(`/v1/orgs/${solo.id}/members/${c.id}`).set(bearer(c.token)).expect(204);

    expect(await service.runOnce()).toMatchObject({ deletedAccounts: 0, deletedUserMedia: 0 });
    expect(await n(`SELECT count(*) AS n FROM audit_events WHERE action = 'org.suspended_orphaned'`, [])).toBe(1);
  });
});
