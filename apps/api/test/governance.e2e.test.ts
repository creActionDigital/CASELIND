import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
  handle: string;
  identifier: string;
}
async function user(roles?: string[]): Promise<TU> {
  const { tokens, identifier } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle, identifier };
}
const call = (method: 'get' | 'put', u: TU | null, path: string, body?: Record<string, unknown>) => {
  const r = ctx.http[method](`/v1${path}`);
  return (u ? r.set(bearer(u.token)) : r).send(body ?? {});
};
let n = 0;
async function org(owner: TU): Promise<{ id: string; slug: string }> {
  n += 1;
  const slug = `gouv-${Date.now().toString(36)}-${n}`;
  const id = (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: 'Boutique Gouv', kind: 'shop' }).expect(201)).body.id;
  return { id, slug };
}

describe('platform governance (audit gap G1)', () => {
  it('only an administrator; suspend and reactivate an account, with a reason, audited', async () => {
    const [admin, other, target, peer] = [await user(['user', 'admin']), await user(), await user(), await user(['user', 'admin'])];
    await call('get', other, '/admin/users').expect(403);
    await call('put', other, `/admin/users/${target.id}/status`, { status: 'suspended', reason: 'spam repete' }).expect(403);

    const found = (await call('get', admin, `/admin/users?q=${encodeURIComponent(target.handle)}`).expect(200)).body.items;
    expect(found.map((u: { id: string }) => u.id)).toContain(target.id);
    expect(JSON.stringify(found)).not.toContain('@'); // no email in the list

    await call('put', admin, `/admin/users/${target.id}/status`, { status: 'suspended', reason: 'x' }).expect(400); // reason too short
    await call('put', admin, `/admin/users/${admin.id}/status`, { status: 'suspended', reason: 'moi-meme' }).expect(409); // self
    await call('put', admin, `/admin/users/${peer.id}/status`, { status: 'suspended', reason: 'autre admin' }).expect(409); // another admin
    await call('put', admin, '/admin/users/00000000-0000-4000-8000-000000000000/status', { status: 'suspended', reason: 'inconnu' }).expect(404);
    await call('put', admin, `/admin/users/${target.id}/status`, { status: 'active', reason: 'deja actif' }).expect(409); // unchanged

    await call('put', admin, `/admin/users/${target.id}/status`, { status: 'suspended', reason: 'contenu abusif repete' }).expect(204);
    await call('get', target, '/me').expect(401); // the session stops working at once
    expect((await ctx.http.post('/v1/auth/login').send({ identifier: target.identifier, password: PASSWORD })).status).not.toBe(200);
    expect((await call('get', admin, '/admin/users?status=suspended').expect(200)).body.items.map((u: { id: string }) => u.id)).toContain(target.id);

    await call('put', admin, `/admin/users/${target.id}/status`, { status: 'active', reason: 'appel accepte' }).expect(204);
    await ctx.http.post('/v1/auth/login').send({ identifier: target.identifier, password: PASSWORD }).expect(200);

    const audits = await ctx.sql.query(`SELECT metadata::text AS md FROM audit_events WHERE action = 'admin.user_status' AND subject_user_id = $1 ORDER BY occurred_at`, [target.id]);
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows[0].md).toContain('contenu abusif repete');
  });

  it('suspend an organisation and set its verification; the public page follows', async () => {
    const [admin, owner, other] = [await user(['user', 'admin']), await user(), await user()];
    const o = await org(owner);
    await call('put', other, `/admin/orgs/${o.id}/status`, { status: 'suspended', reason: 'non autorise' }).expect(403);
    expect((await call('get', admin, `/admin/orgs?q=${o.slug}`).expect(200)).body.items[0]).toMatchObject({ id: o.id, status: 'active', verificationStatus: 'unverified' });

    expect((await call('get', null, `/public/orgs/${o.slug}`).expect(200)).body.verified).toBe(false);
    await call('put', admin, `/admin/orgs/${o.id}/verification`, { status: 'verified' }).expect(409); // a reason is required
    await call('put', admin, `/admin/orgs/${o.id}/verification`, { status: 'verified', reason: 'registre de commerce controle' }).expect(204);
    expect((await call('get', null, `/public/orgs/${o.slug}`).expect(200)).body.verified).toBe(true);
    await call('put', admin, `/admin/orgs/${o.id}/verification`, { status: 'verified', reason: 'encore' }).expect(409); // unchanged

    await call('put', admin, `/admin/orgs/${o.id}/status`, { status: 'suspended', reason: 'plaintes clients' }).expect(204);
    await call('get', null, `/public/orgs/${o.slug}`).expect(404); // a suspended organisation leaves the public pages
    await call('put', admin, `/admin/orgs/${o.id}/status`, { status: 'active', reason: 'regularisee' }).expect(204);
    await call('get', null, `/public/orgs/${o.slug}`).expect(200);
    await call('put', admin, '/admin/orgs/not-a-uuid/status', { status: 'suspended', reason: 'abc' }).expect(404);

    const audits = await ctx.sql.query(`SELECT action FROM audit_events WHERE action IN ('admin.org_status', 'admin.org_verification')`);
    expect(audits.rows.length).toBeGreaterThanOrEqual(3);
  });
});
