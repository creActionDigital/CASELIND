import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_OWNED_ORGS } from '../src/orgs/orgs.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

interface TestUser {
  token: string;
  id: string;
  handle: string;
}

/** Signs up a user and returns their token, id and handle. */
async function user(): Promise<TestUser> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

let slugCounter = 0;
const uniqueSlug = (prefix = 'shop') => `${prefix}-${Date.now().toString(36)}-${++slugCounter}`;

async function createOrg(owner: TestUser, extra: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const slug = uniqueSlug();
  const res = await ctx.http
    .post('/v1/orgs')
    .set(bearer(owner.token))
    .send({ slug, name: 'Boutique Test', kind: 'shop', ...extra })
    .expect(201);
  return { id: res.body.id, slug: res.body.slug };
}

/** Invites `invitee` with `role` (by `inviter`) and accepts. */
async function addMember(orgId: string, inviter: TestUser, invitee: TestUser, role: string): Promise<void> {
  await ctx.http
    .post(`/v1/orgs/${orgId}/invitations`)
    .set(bearer(inviter.token))
    .send({ handle: invitee.handle, role })
    .expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(invitee.token)).expect(200);
}

const suspend = (orgId: string) => ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [orgId]);

describe('creating an organisation', () => {
  it('creates the org, makes the creator its active owner and audits it', async () => {
    const a = await user();
    const slug = uniqueSlug('Resto');
    const res = await ctx.http
      .post('/v1/orgs')
      .set(bearer(a.token))
      .send({
        slug,
        name: '  Chez Mama  ',
        kind: 'restaurant',
        city: 'Kinshasa',
        country: 'CD',
        phone: '+243810000000',
        website: 'https://chezmama.example.com',
        openingHours: { mon: [{ open: '08:00', close: '14:00' }, { open: '18:00', close: '23:00' }] },
      })
      .expect(201);
    expect(res.body).toMatchObject({
      slug: slug.toLowerCase(),
      name: 'Chez Mama',
      kind: 'restaurant',
      visibility: 'public',
      status: 'active',
      verificationStatus: 'unverified',
      createdBy: a.id,
      logoUrl: null,
      openingHours: { mon: [{ open: '08:00', close: '14:00' }, { open: '18:00', close: '23:00' }] },
    });

    const mine = await ctx.http.get('/v1/me/orgs').set(bearer(a.token)).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ org: { id: res.body.id, slug: slug.toLowerCase() }, role: 'owner', status: 'active' });
    expect(mine.body.items[0].joinedAt).not.toBeNull();

    const { rows } = await ctx.sql.query(
      `SELECT metadata FROM audit_events WHERE action = 'org.created' AND actor_user_id = $1`,
      [a.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ orgId: res.body.id, kind: 'restaurant' });
  });

  it('refuses a taken slug (case-insensitive) with 409 field slug, and malformed or reserved slugs with 400', async () => {
    const a = await user();
    const b = await user();
    const { slug } = await createOrg(a);
    const dup = await ctx.http
      .post('/v1/orgs')
      .set(bearer(b.token))
      .send({ slug: slug.toUpperCase(), name: 'Copy', kind: 'shop' })
      .expect(409);
    expect(dup.body.error.code).toBe('conflict');
    expect(dup.body.error.details).toEqual({ field: 'slug' });

    for (const bad of ['ab', '-shop', 'shop-', 'sh op', 'a'.repeat(41), 'admin']) {
      await ctx.http.post('/v1/orgs').set(bearer(b.token)).send({ slug: bad, name: 'X', kind: 'shop' }).expect(400);
    }
    await ctx.http.post('/v1/orgs').set(bearer(b.token)).send({ slug: uniqueSlug(), name: 'X', kind: 'casino' }).expect(400);
    await ctx.http.post('/v1/orgs').send({ slug: uniqueSlug(), name: 'X', kind: 'shop' }).expect(401);
  });

  it(`limits a user to ${MAX_OWNED_ORGS} owned organisations`, async () => {
    const a = await user();
    for (let i = 0; i < MAX_OWNED_ORGS; i++) await createOrg(a);
    const res = await ctx.http
      .post('/v1/orgs')
      .set(bearer(a.token))
      .send({ slug: uniqueSlug(), name: 'One too many', kind: 'shop' })
      .expect(409);
    expect(res.body.error.details).toEqual({ reason: 'owner_limit', limit: MAX_OWNED_ORGS });
  });
});

describe('public storefront', () => {
  it('is readable without a token and exposes public fields only', async () => {
    const a = await user();
    const { id, slug } = await createOrg(a, { description: 'Pagnes et wax', city: 'Goma' });
    const res = await ctx.http.get(`/v1/public/orgs/${slug}`).expect(200);
    expect(res.body).toMatchObject({ id, slug, name: 'Boutique Test', description: 'Pagnes et wax', city: 'Goma', verified: false });
    for (const hidden of ['status', 'visibility', 'createdBy', 'verificationStatus', 'createdAt', 'updatedAt']) {
      expect(res.body).not.toHaveProperty(hidden);
    }
    // The slug lookup is case-insensitive.
    await ctx.http.get(`/v1/public/orgs/${slug.toUpperCase()}`).expect(200);
  });

  it('is 404 for private, suspended, unknown and malformed slugs', async () => {
    const a = await user();
    const priv = await createOrg(a, { visibility: 'private' });
    await ctx.http.get(`/v1/public/orgs/${priv.slug}`).expect(404);

    const pub = await createOrg(a);
    await suspend(pub.id);
    const suspended = await ctx.http.get(`/v1/public/orgs/${pub.slug}`).expect(404);
    const unknown = await ctx.http.get(`/v1/public/orgs/${uniqueSlug('nope')}`).expect(404);
    expect(suspended.body.error.message).toBe(unknown.body.error.message);
    await ctx.http.get('/v1/public/orgs/x').expect(404);
  });
});

describe('access control', () => {
  it('answers 404 to non-members, invitees and malformed ids', async () => {
    const owner = await user();
    const stranger = await user();
    const { id } = await createOrg(owner, { visibility: 'private' });
    await ctx.http.get(`/v1/orgs/${id}`).set(bearer(owner.token)).expect(200);

    const res = await ctx.http.get(`/v1/orgs/${id}`).set(bearer(stranger.token)).expect(404);
    const unknown = await ctx.http.get(`/v1/orgs/${randomUUID()}`).set(bearer(stranger.token)).expect(404);
    expect(res.body.error.message).toBe(unknown.body.error.message);
    await ctx.http.get('/v1/orgs/not-a-uuid').set(bearer(stranger.token)).expect(404);
    await ctx.http.patch(`/v1/orgs/${id}`).set(bearer(stranger.token)).send({ name: 'Hijack' }).expect(404);
    await ctx.http.get(`/v1/orgs/${id}/members`).set(bearer(stranger.token)).expect(404);

    // A pending invitation grants nothing yet.
    await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: stranger.handle, role: 'manager' }).expect(201);
    await ctx.http.get(`/v1/orgs/${id}`).set(bearer(stranger.token)).expect(404);
  });

  it('answers 403 to members whose role lacks the permission', async () => {
    const owner = await user();
    const employee = await user();
    const hr = await user();
    const { id } = await createOrg(owner);
    await addMember(id, owner, employee, 'employee');
    await addMember(id, owner, hr, 'hr');

    await ctx.http.get(`/v1/orgs/${id}`).set(bearer(employee.token)).expect(200);
    const patch = await ctx.http.patch(`/v1/orgs/${id}`).set(bearer(employee.token)).send({ name: 'Mine now' }).expect(403);
    expect(patch.body.error.code).toBe('forbidden');
    await ctx.http.get(`/v1/orgs/${id}/members`).set(bearer(employee.token)).expect(403);
    await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(employee.token)).send({ handle: owner.handle, role: 'employee' }).expect(403);
    await ctx.http.patch(`/v1/orgs/${id}/members/${hr.id}`).set(bearer(employee.token)).send({ role: 'employee' }).expect(403);
    await ctx.http.delete(`/v1/orgs/${id}/members/${hr.id}`).set(bearer(employee.token)).expect(403);

    // hr can see the team but not manage it.
    await ctx.http.get(`/v1/orgs/${id}/members`).set(bearer(hr.token)).expect(200);
    await ctx.http.patch(`/v1/orgs/${id}/members/${employee.id}`).set(bearer(hr.token)).send({ role: 'sales' }).expect(403);
  });

  it('makes a suspended org read-only for its owners and closed to everyone else', async () => {
    const owner = await user();
    const admin = await user();
    const { id } = await createOrg(owner);
    await addMember(id, owner, admin, 'admin');
    await suspend(id);

    const res = await ctx.http.get(`/v1/orgs/${id}`).set(bearer(owner.token)).expect(200);
    expect(res.body.status).toBe('suspended');
    await ctx.http.get(`/v1/orgs/${id}/members`).set(bearer(owner.token)).expect(200);
    await ctx.http.patch(`/v1/orgs/${id}`).set(bearer(owner.token)).send({ name: 'Renamed' }).expect(403);
    await ctx.http.get(`/v1/orgs/${id}`).set(bearer(admin.token)).expect(403);
    // Removing someone else stays closed; leaving is always possible (last-owner rule still applies).
    const employee = await user();
    await ctx.sql.query(
      `INSERT INTO org_members (org_id, user_id, role, status, joined_at) VALUES ($1, $2, 'employee', 'active', now())`,
      [id, employee.id],
    );
    await ctx.http.delete(`/v1/orgs/${id}/members/${employee.id}`).set(bearer(owner.token)).expect(403);
    await ctx.http.delete(`/v1/orgs/${id}/members/${employee.id}`).set(bearer(admin.token)).expect(403);
    await ctx.http.delete(`/v1/orgs/${id}/members/${admin.id}`).set(bearer(admin.token)).expect(204);
    await ctx.http.delete(`/v1/orgs/${id}/members/${employee.id}`).set(bearer(employee.token)).expect(204);
    const last = await ctx.http.delete(`/v1/orgs/${id}/members/${owner.id}`).set(bearer(owner.token)).expect(409);
    expect(last.body.error.details).toMatchObject({ reason: 'last_owner' });
  });

  it('resets a granted or pending verification when an identity field changes, and audits it', async () => {
    const owner = await user();
    const { id } = await createOrg(owner);
    const setVerification = (v: string) =>
      ctx.sql.query('UPDATE organizations SET verification_status = $1 WHERE id = $2', [v, id]);
    const lastUpdateMeta = async () =>
      (
        await ctx.sql.query(
          `SELECT metadata FROM audit_events WHERE action = 'org.updated' AND metadata->>'orgId' = $1
           ORDER BY occurred_at DESC, id DESC LIMIT 1`,
          [id],
        )
      ).rows[0].metadata;

    await setVerification('verified');
    // Non-identity field, or an identity field set to its current value: verification kept.
    let res = await ctx.http.patch(`/v1/orgs/${id}`).set(bearer(owner.token)).send({ description: 'Wax', name: 'Boutique Test' }).expect(200);
    expect(res.body.verificationStatus).toBe('verified');
    expect(await lastUpdateMeta()).not.toHaveProperty('verificationReset');

    res = await ctx.http.patch(`/v1/orgs/${id}`).set(bearer(owner.token)).send({ name: 'Autre Boutique' }).expect(200);
    expect(res.body.verificationStatus).toBe('unverified');
    expect(await lastUpdateMeta()).toMatchObject({ verificationReset: { from: 'verified', to: 'unverified', fields: ['name'] } });

    await setVerification('pending');
    res = await ctx.http.patch(`/v1/orgs/${id}`).set(bearer(owner.token)).send({ website: 'https://example.com', city: 'Goma' }).expect(200);
    expect(res.body.verificationStatus).toBe('unverified');
    expect(await lastUpdateMeta()).toMatchObject({ verificationReset: { from: 'pending', fields: ['website'] } });
  });
});

describe('invitations', () => {
  it('invites by handle; the invitee sees, accepts or declines it; everything is audited', async () => {
    const owner = await user();
    const alice = await user();
    const bob = await user();
    const { id } = await createOrg(owner);

    const inv = await ctx.http
      .post(`/v1/orgs/${id}/invitations`)
      .set(bearer(owner.token))
      .send({ handle: alice.handle, role: 'sales' })
      .expect(201);
    expect(inv.body).toMatchObject({ userId: alice.id, handle: alice.handle, role: 'sales', status: 'invited', invitedBy: owner.id, joinedAt: null });
    await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: bob.handle, role: 'stock' }).expect(201);

    const pending = await ctx.http.get('/v1/me/orgs').set(bearer(alice.token)).expect(200);
    expect(pending.body.items).toEqual([
      expect.objectContaining({ org: expect.objectContaining({ id }), role: 'sales', status: 'invited', joinedAt: null }),
    ]);

    const accepted = await ctx.http.post(`/v1/me/org-invitations/${id}/accept`).set(bearer(alice.token)).expect(200);
    expect(accepted.body).toMatchObject({ org: { id }, role: 'sales', status: 'active' });
    expect(accepted.body.joinedAt).not.toBeNull();
    await ctx.http.get(`/v1/orgs/${id}`).set(bearer(alice.token)).expect(200);
    // Accepting twice, or an invitation that does not exist: 404.
    await ctx.http.post(`/v1/me/org-invitations/${id}/accept`).set(bearer(alice.token)).expect(404);
    await ctx.http.post(`/v1/me/org-invitations/${randomUUID()}/accept`).set(bearer(alice.token)).expect(404);
    await ctx.http.post('/v1/me/org-invitations/nope/accept').set(bearer(alice.token)).expect(404);

    await ctx.http.post(`/v1/me/org-invitations/${id}/decline`).set(bearer(bob.token)).expect(204);
    expect((await ctx.http.get('/v1/me/orgs').set(bearer(bob.token)).expect(200)).body.items).toEqual([]);
    await ctx.http.post(`/v1/me/org-invitations/${id}/decline`).set(bearer(bob.token)).expect(404);
    // An active member cannot "decline" their membership.
    await ctx.http.post(`/v1/me/org-invitations/${id}/decline`).set(bearer(alice.token)).expect(404);

    const { rows } = await ctx.sql.query(
      `SELECT action, actor_user_id, metadata FROM audit_events WHERE metadata->>'orgId' = $1 ORDER BY id`,
      [id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'org.created',
      'org.member_invited',
      'org.member_invited',
      'org.invitation_accepted',
      'org.invitation_declined',
    ]);
    expect(rows[1]).toMatchObject({ actor_user_id: owner.id, metadata: { userId: alice.id, role: 'sales' } });
    expect(rows[3].actor_user_id).toBe(alice.id);
  });

  it('refuses already-member (409), unknown handle (404) and invalid roles (400)', async () => {
    const owner = await user();
    const alice = await user();
    const { id } = await createOrg(owner);
    await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: alice.handle, role: 'support' }).expect(201);
    const again = await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: alice.handle, role: 'support' }).expect(409);
    expect(again.body.error.details).toEqual({ reason: 'already_member' });
    await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: owner.handle, role: 'support' }).expect(409);
    await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: 'nobody_here_123', role: 'support' }).expect(404);
    await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: alice.handle, role: 'king' }).expect(400);
  });

  it('cannot invite across a block (either direction), with the same 404 as an unknown handle', async () => {
    const owner = await user();
    const blocker = await user();
    const blocked = await user();
    const { id } = await createOrg(owner);
    await ctx.http.put(`/v1/blocks/${owner.id}`).set(bearer(blocker.token)).expect(204);
    await ctx.http.put(`/v1/blocks/${blocked.id}`).set(bearer(owner.token)).expect(204);

    const a = await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: blocker.handle, role: 'employee' }).expect(404);
    const b = await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: blocked.handle, role: 'employee' }).expect(404);
    const unknown = await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: 'ghost_user_42', role: 'employee' }).expect(404);
    expect(a.body.error.message).toBe(unknown.body.error.message);
    expect(b.body.error.message).toBe(unknown.body.error.message);
  });
});

describe('role management', () => {
  it('lets owners grant admin but refuses escalation by admins', async () => {
    const owner = await user();
    const admin = await user();
    const emp = await user();
    const newcomer = await user();
    const { id } = await createOrg(owner);
    await addMember(id, owner, admin, 'admin');
    await addMember(id, admin, emp, 'employee');

    for (const role of ['admin', 'owner']) {
      const res = await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(admin.token)).send({ handle: newcomer.handle, role }).expect(403);
      expect(res.body.error.code).toBe('forbidden');
      await ctx.http.patch(`/v1/orgs/${id}/members/${emp.id}`).set(bearer(admin.token)).send({ role }).expect(403);
    }
    // Admins can neither demote nor remove an owner or another admin (themselves included via PATCH).
    await ctx.http.patch(`/v1/orgs/${id}/members/${owner.id}`).set(bearer(admin.token)).send({ role: 'employee' }).expect(403);
    await ctx.http.patch(`/v1/orgs/${id}/members/${admin.id}`).set(bearer(admin.token)).send({ role: 'employee' }).expect(403);
    await ctx.http.delete(`/v1/orgs/${id}/members/${owner.id}`).set(bearer(admin.token)).expect(403);

    // ...but manage ordinary roles.
    const changed = await ctx.http.patch(`/v1/orgs/${id}/members/${emp.id}`).set(bearer(admin.token)).send({ role: 'delivery' }).expect(200);
    expect(changed.body).toMatchObject({ userId: emp.id, role: 'delivery', status: 'active' });

    // The owner can promote.
    await ctx.http.patch(`/v1/orgs/${id}/members/${emp.id}`).set(bearer(owner.token)).send({ role: 'admin' }).expect(200);

    const { rows } = await ctx.sql.query(
      `SELECT metadata FROM audit_events WHERE action = 'org.member_role_changed' AND metadata->>'orgId' = $1 ORDER BY id`,
      [id],
    );
    expect(rows.map((r) => [r.metadata.from, r.metadata.to])).toEqual([
      ['employee', 'delivery'],
      ['delivery', 'admin'],
    ]);

    await ctx.http.patch(`/v1/orgs/${id}/members/${randomUUID()}`).set(bearer(owner.token)).send({ role: 'sales' }).expect(404);
    await ctx.http.patch(`/v1/orgs/${id}/members/nope`).set(bearer(owner.token)).send({ role: 'sales' }).expect(404);
  });

  it('removes members, cancels invitations and lets members leave', async () => {
    const owner = await user();
    const admin = await user();
    const emp = await user();
    const invitee = await user();
    const { id } = await createOrg(owner);
    await addMember(id, owner, admin, 'admin');
    await addMember(id, owner, emp, 'employee');
    await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: invitee.handle, role: 'sales' }).expect(201);

    await ctx.http.delete(`/v1/orgs/${id}/members/${invitee.id}`).set(bearer(admin.token)).expect(204);
    expect((await ctx.http.get('/v1/me/orgs').set(bearer(invitee.token)).expect(200)).body.items).toEqual([]);

    await ctx.http.delete(`/v1/orgs/${id}/members/${emp.id}`).set(bearer(admin.token)).expect(204);
    await ctx.http.get(`/v1/orgs/${id}`).set(bearer(emp.token)).expect(404);

    // An admin can leave on their own.
    await ctx.http.delete(`/v1/orgs/${id}/members/${admin.id}`).set(bearer(admin.token)).expect(204);
    await ctx.http.get(`/v1/orgs/${id}`).set(bearer(admin.token)).expect(404);
    await ctx.http.delete(`/v1/orgs/${id}/members/${emp.id}`).set(bearer(owner.token)).expect(404);

    const { rows } = await ctx.sql.query(
      `SELECT metadata FROM audit_events WHERE action = 'org.member_removed' AND metadata->>'orgId' = $1 ORDER BY id`,
      [id],
    );
    expect(rows.map((r) => [r.metadata.userId, r.metadata.self])).toEqual([
      [invitee.id, false],
      [emp.id, false],
      [admin.id, true],
    ]);
  });

  it('protects the last active owner from demotion, removal and leaving', async () => {
    const owner = await user();
    const second = await user();
    const { id } = await createOrg(owner);

    const demote = await ctx.http.patch(`/v1/orgs/${id}/members/${owner.id}`).set(bearer(owner.token)).send({ role: 'admin' }).expect(409);
    expect(demote.body.error.details).toEqual({ reason: 'last_owner' });
    const leave = await ctx.http.delete(`/v1/orgs/${id}/members/${owner.id}`).set(bearer(owner.token)).expect(409);
    expect(leave.body.error.details).toEqual({ reason: 'last_owner' });

    // A pending owner invitation does not count as an owner.
    await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: second.handle, role: 'owner' }).expect(201);
    await ctx.http.delete(`/v1/orgs/${id}/members/${owner.id}`).set(bearer(owner.token)).expect(409);

    await ctx.http.post(`/v1/me/org-invitations/${id}/accept`).set(bearer(second.token)).expect(200);
    // Two owners: one can now be removed by the other, then the survivor is protected again.
    await ctx.http.delete(`/v1/orgs/${id}/members/${owner.id}`).set(bearer(second.token)).expect(204);
    await ctx.http.delete(`/v1/orgs/${id}/members/${second.id}`).set(bearer(second.token)).expect(409);
    await ctx.http.patch(`/v1/orgs/${id}/members/${second.id}`).set(bearer(second.token)).send({ role: 'employee' }).expect(409);

    const { rows } = await ctx.sql.query(
      `SELECT count(*)::int AS n FROM org_members WHERE org_id = $1 AND role = 'owner' AND status = 'active'`,
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('keeps one owner when two owners demote each other concurrently', async () => {
    const a = await user();
    const b = await user();
    const { id } = await createOrg(a);
    await addMember(id, a, b, 'owner');

    const [r1, r2] = await Promise.all([
      ctx.http.patch(`/v1/orgs/${id}/members/${b.id}`).set(bearer(a.token)).send({ role: 'admin' }),
      ctx.http.patch(`/v1/orgs/${id}/members/${a.id}`).set(bearer(b.token)).send({ role: 'admin' }),
    ]);
    // The second transaction sees the first one's result: either its actor is no longer an
    // owner (403) or it would remove the last owner (409). Never both 200.
    expect([r1.status, r2.status].filter((s) => s === 200)).toHaveLength(1);
    const { rows } = await ctx.sql.query(
      `SELECT count(*)::int AS n FROM org_members WHERE org_id = $1 AND role = 'owner' AND status = 'active'`,
      [id],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('profile updates', () => {
  it('applies a partial update, clears fields with null and audits the changed fields', async () => {
    const owner = await user();
    const { id } = await createOrg(owner, { city: 'Lubumbashi' });
    const res = await ctx.http
      .patch(`/v1/orgs/${id}`)
      .set(bearer(owner.token))
      .send({
        description: 'Quincaillerie',
        city: null,
        website: 'https://quincaillerie.example.cd/accueil',
        openingHours: { sat: [{ open: '09:00', close: '24:00' }], sun: [] },
        kind: 'warehouse',
      })
      .expect(200);
    expect(res.body).toMatchObject({
      description: 'Quincaillerie',
      city: null,
      kind: 'warehouse',
      website: 'https://quincaillerie.example.cd/accueil',
      openingHours: { sat: [{ open: '09:00', close: '24:00' }], sun: [] },
    });
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(res.body.createdAt).getTime());

    const { rows } = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'org.updated' AND metadata->>'orgId' = $1`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.fields.sort()).toEqual(['city', 'description', 'kind', 'openingHours', 'website']);
  });

  it('rejects invalid patches with 400', async () => {
    const owner = await user();
    const { id } = await createOrg(owner);
    const bad: Record<string, unknown>[] = [
      {},
      { website: 'http://insecure.example.com' },
      { website: 'javascript:alert(1)' },
      { phone: '0810000000' },
      { email: 'not-an-email' },
      { country: 'cd' },
      { name: '' },
      { description: 'x'.repeat(2001) },
      { visibility: 'secret' },
      { openingHours: { mon: [{ open: '25:00', close: '26:00' }] } },
      { openingHours: { mon: [{ open: '18:00', close: '08:00' }] } },
      { openingHours: { mon: [{ open: '08:00', close: '12:00' }, { open: '11:00', close: '14:00' }] } },
      { openingHours: { monday: [{ open: '08:00', close: '12:00' }] } },
      { openingHours: { mon: [{ open: '8h', close: '12h' }] } },
    ];
    for (const body of bad) {
      const res = await ctx.http.patch(`/v1/orgs/${id}`).set(bearer(owner.token)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
    // status / verification / slug / logo cannot be set by the org itself (stripped, so the patch is empty).
    await ctx.http.patch(`/v1/orgs/${id}`).set(bearer(owner.token)).send({ status: 'active', verificationStatus: 'verified' }).expect(400);
    const after = await ctx.http.get(`/v1/orgs/${id}`).set(bearer(owner.token)).expect(200);
    expect(after.body.verificationStatus).toBe('unverified');
  });
});

describe('members list', () => {
  it('paginates oldest first without overlap and filters by status', async () => {
    const owner = await user();
    const { id } = await createOrg(owner);
    const others = await Promise.all([user(), user(), user(), user()]);
    for (const u of others) {
      await ctx.http.post(`/v1/orgs/${id}/invitations`).set(bearer(owner.token)).send({ handle: u.handle, role: 'employee' }).expect(201);
    }
    await ctx.http.post(`/v1/me/org-invitations/${id}/accept`).set(bearer(others[0]!.token)).expect(200);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { items: { userId: string }[]; nextCursor: string | null } } = await ctx.http
        .get(`/v1/orgs/${id}/members`)
        .query(cursor ? { limit: 2, cursor } : { limit: 2 })
        .set(bearer(owner.token))
        .expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items.map((m) => m.userId));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([owner.id, ...others.map((u) => u.id)]);

    const active = await ctx.http.get(`/v1/orgs/${id}/members`).query({ status: 'active' }).set(bearer(owner.token)).expect(200);
    expect(active.body.items.map((m: { userId: string }) => m.userId)).toEqual([owner.id, others[0]!.id]);
    expect(active.body.items[0]).toMatchObject({ handle: owner.handle, displayName: 'Test User', role: 'owner', status: 'active' });

    await ctx.http.get(`/v1/orgs/${id}/members`).query({ cursor: 'garbage' }).set(bearer(owner.token)).expect(400);
    await ctx.http.get(`/v1/orgs/${id}/members`).query({ limit: 0 }).set(bearer(owner.token)).expect(400);
  });
});

describe('mini-site content (page, logo, banner)', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  async function uploadImage(token: string, purpose: string): Promise<string> {
    const up = await ctx.http.post('/v1/media/uploads').set(bearer(token)).send({ purpose, mime: 'image/png', sizeBytes: PNG.length }).expect(201);
    await ctx.http.put(up.body.uploadUrl).set(bearer(token)).set('X-Upload-Token', up.body.uploadToken).set('Content-Type', 'application/octet-stream').send(PNG).expect(200);
    return up.body.assetId as string;
  }

  it('stores links, areas, sections and FAQ, shows them on the public page, and refuses bad content', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const empty = await ctx.http.get(`/v1/public/orgs/${org.slug}`).expect(200);
    expect(empty.body.page).toEqual({ links: [], serviceAreas: [], sections: [], faq: [] });

    const page = {
      links: [{ label: 'Facebook', url: 'https://facebook.com/boutique' }],
      serviceAreas: ['Goma', 'Gisenyi'],
      sections: [{ title: 'Conditions', body: 'Retours sous 7 jours.' }],
      faq: [{ question: 'Livrez-vous ?', answer: 'Oui, dans Goma.' }],
    };
    await ctx.http.patch(`/v1/orgs/${org.id}`).set(bearer(owner.token)).send({ page }).expect(200);
    expect((await ctx.http.get(`/v1/public/orgs/${org.slug}`).expect(200)).body.page).toEqual(page);

    const bad = (p: unknown) => ctx.http.patch(`/v1/orgs/${org.id}`).set(bearer(owner.token)).send({ page: p }).expect(400);
    await bad({ ...page, links: [{ label: 'X', url: 'http://insecure.example.com' }] });
    await bad({ ...page, sections: Array.from({ length: 11 }, () => ({ title: 't', body: 'b' })) });
    await bad({ ...page, faq: [{ question: '', answer: 'a' }] });
    await bad({ links: [] });
    // Only members with org.profile.edit may change it.
    const stranger = await user();
    await ctx.http.patch(`/v1/orgs/${org.id}`).set(bearer(stranger.token)).send({ page }).expect(404);
  });

  it('sets and removes the logo and banner from own ready uploads only', async () => {
    const owner = await user();
    const other = await user();
    const org = await createOrg(owner);
    const logo = await uploadImage(owner.token, 'org_logo');
    const banner = await uploadImage(owner.token, 'org_banner');
    const res = await ctx.http.patch(`/v1/orgs/${org.id}`).set(bearer(owner.token)).send({ logoMediaId: logo, bannerMediaId: banner }).expect(200);
    expect(res.body.logoUrl).toContain(logo);
    expect(res.body.bannerUrl).toContain(banner);
    expect((await ctx.http.get(`/v1/public/orgs/${org.slug}`).expect(200)).body.logoUrl).toContain(logo);

    // Wrong purpose, someone else's upload, unknown id: 400.
    await ctx.http.patch(`/v1/orgs/${org.id}`).set(bearer(owner.token)).send({ logoMediaId: banner }).expect(400);
    const foreign = await uploadImage(other.token, 'org_logo');
    await ctx.http.patch(`/v1/orgs/${org.id}`).set(bearer(owner.token)).send({ logoMediaId: foreign }).expect(400);
    await ctx.http.patch(`/v1/orgs/${org.id}`).set(bearer(owner.token)).send({ logoMediaId: randomUUID() }).expect(400);

    const gone = await ctx.http.patch(`/v1/orgs/${org.id}`).set(bearer(owner.token)).send({ logoMediaId: null }).expect(200);
    expect(gone.body.logoUrl).toBeNull();
    expect(gone.body.bannerUrl).toContain(banner);
  });
});

describe('storefront gallery', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  async function uploadAs(token: string, purpose: string): Promise<string> {
    const up = await ctx.http.post('/v1/media/uploads').set(bearer(token)).send({ purpose, mime: 'image/png', sizeBytes: PNG.length }).expect(201);
    await ctx.http.put(up.body.uploadUrl).set(bearer(token)).set('X-Upload-Token', up.body.uploadToken).set('Content-Type', 'application/octet-stream').send(PNG).expect(200);
    return up.body.assetId as string;
  }

  it('replaces the gallery in order, shows it publicly, deletes dropped files and refuses bad input', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const [a, b, c] = [await uploadAs(owner.token, 'org_gallery'), await uploadAs(owner.token, 'org_gallery'), await uploadAs(owner.token, 'org_gallery')];
    const put = (ids: string[], token = owner.token) => ctx.http.put(`/v1/orgs/${org.id}/gallery`).set(bearer(token)).send({ assetIds: ids });

    const set = await put([b, a, c]).expect(200);
    expect(set.body.items.map((f: { id: string }) => f.id)).toEqual([b, a, c]);
    const pub = await ctx.http.get(`/v1/public/orgs/${org.slug}`).expect(200);
    expect(pub.body.gallery.map((f: { id: string }) => f.id)).toEqual([b, a, c]);
    expect((await ctx.http.get(`/v1/orgs/${org.id}/gallery`).set(bearer(owner.token)).expect(200)).body.items).toHaveLength(3);

    // Any signed-in user reads the content, like a product image.
    const visitor = await user();
    await ctx.http.get(pub.body.gallery[0].contentUrl).set(bearer(visitor.token)).expect(200);

    // Dropping a file deletes it.
    await put([a]).expect(200);
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM media_assets WHERE id = ANY($1::uuid[])`, [[b, c]])).rows[0].n).toBe(0);

    // Wrong purpose, someone else's upload, duplicates, too many, stranger: refused.
    await put([await uploadAs(owner.token, 'org_logo')]).expect(400);
    await put([await uploadAs(visitor.token, 'org_gallery')]).expect(400);
    await put([a, a]).expect(400);
    await put(Array.from({ length: 13 }, () => randomUUID())).expect(400);
    await put([a], visitor.token).expect(404);

    await put([]).expect(200);
    expect((await ctx.http.get(`/v1/public/orgs/${org.slug}`).expect(200)).body.gallery).toEqual([]);
  });
});
