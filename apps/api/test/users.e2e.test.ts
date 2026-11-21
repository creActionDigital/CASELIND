import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('profile', () => {
  it('updates the profile and rejects a handle already taken (case-insensitive)', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);

    const res = await ctx.http
      .patch('/v1/me')
      .set(bearer(a.tokens.accessToken))
      .send({ handle: 'Mama_Ntoto', bio: 'Boutique de pagnes à Goma', locale: 'sw', country: 'CD' })
      .expect(200);
    expect(res.body).toMatchObject({ handle: 'Mama_Ntoto', locale: 'sw', country: 'CD' });

    const clash = await ctx.http
      .patch('/v1/me')
      .set(bearer(b.tokens.accessToken))
      .send({ handle: 'mama_ntoto' })
      .expect(409);
    expect(clash.body.error).toMatchObject({ code: 'conflict', details: { field: 'handle' } });
  });

  it('ignores fields that are not part of the contract (no privilege escalation via PATCH)', async () => {
    const a = await signUp(ctx);
    await ctx.http
      .patch('/v1/me')
      .set(bearer(a.tokens.accessToken))
      .send({ displayName: 'Honest', roles: ['admin'], status: 'active' })
      .expect(200);
    const me = await ctx.http.get('/v1/me').set(bearer(a.tokens.accessToken)).expect(200);
    expect(me.body.roles).toEqual(['user']);
  });

  it('rejects an empty patch and invalid values', async () => {
    const a = await signUp(ctx);
    await ctx.http.patch('/v1/me').set(bearer(a.tokens.accessToken)).send({}).expect(400);
    await ctx.http.patch('/v1/me').set(bearer(a.tokens.accessToken)).send({ handle: 'a b' }).expect(400);
    await ctx.http.patch('/v1/me').set(bearer(a.tokens.accessToken)).send({ locale: 'de' }).expect(400);
  });

  it('exposes only public fields of active users by handle', async () => {
    const a = await signUp(ctx);
    const viewer = await signUp(ctx);
    const me = await ctx.http.get('/v1/me').set(bearer(a.tokens.accessToken)).expect(200);

    const res = await ctx.http.get(`/v1/users/${me.body.handle}`).set(bearer(viewer.tokens.accessToken)).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['avatarUrl', 'bio', 'displayName', 'handle', 'id']);
    // Same profile by user id (the mobile profile screens open users by id).
    expect((await ctx.http.get(`/v1/users/${me.body.id}`).set(bearer(viewer.tokens.accessToken)).expect(200)).body).toEqual(res.body);
    await ctx.http.get('/v1/users/a').set(bearer(viewer.tokens.accessToken)).expect(400);

    await ctx.sql.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [me.body.id]);
    await ctx.http.get(`/v1/users/${me.body.handle}`).set(bearer(viewer.tokens.accessToken)).expect(404);
    await ctx.http.get(`/v1/users/${me.body.id}`).set(bearer(viewer.tokens.accessToken)).expect(404);
  });

  it('shows the user their own security log without secrets', async () => {
    const a = await signUp(ctx);
    const res = await ctx.http.get('/v1/me/security-events').set(bearer(a.tokens.accessToken)).expect(200);
    const actions = res.body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.register', 'auth.otp_verified']));
    expect(JSON.stringify(res.body)).not.toMatch(/password|code_hash|refresh/i);
  });
});

describe('RBAC', () => {
  it('admin routes are refused to regular users and allowed to admins (role read from the database)', async () => {
    const user = await signUp(ctx);
    await ctx.http.get('/v1/admin/audit-events').set(bearer(user.tokens.accessToken)).expect(403);

    const admin = await signUp(ctx);
    await ctx.sql.query(`UPDATE users SET roles = ARRAY['user','admin'] WHERE email = $1`, [admin.identifier]);
    // Same token as before the promotion: roles are not trusted from the JWT.
    const res = await ctx.http
      .get('/v1/admin/audit-events?limit=5')
      .set(bearer(admin.tokens.accessToken))
      .expect(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.nextCursor).toEqual(expect.any(String));
  });
});
