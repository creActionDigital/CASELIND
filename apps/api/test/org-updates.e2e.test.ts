import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

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
}

async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

let n = 0;
async function createOrg(owner: TU, extra: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const slug = `news-${Date.now().toString(36)}-${++n}`;
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: 'Boutique News', kind: 'shop', ...extra }).expect(201);
  return { id: res.body.id, slug: res.body.slug };
}

async function addMember(orgId: string, owner: TU, m: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(owner.token)).send({ handle: m.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(m.token)).expect(200);
}

const DAY = 86_400_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const post = (u: TU, orgId: string, body: Record<string, unknown>) => ctx.http.post(`/v1/orgs/${orgId}/updates`).set(bearer(u.token)).send(body);
const pub = (slug: string, q = '') => ctx.http.get(`/v1/public/orgs/${slug}/updates${q}`);

describe('org updates', () => {
  it('creates the three kinds, edits, lists for staff and audits without content', async () => {
    const owner = await user();
    const org = await createOrg(owner);

    const p = (await post(owner, org.id, { kind: 'post', title: '  Nouveauté  ', body: 'Arrivage SECRETTEXT de la semaine' }).expect(201)).body;
    expect(p).toMatchObject({ kind: 'post', title: 'Nouveauté', startsAt: null, endsAt: null, place: null, hidden: false });
    const promo = (await post(owner, org.id, { kind: 'promo', title: 'Solde -20%', body: 'Sur tout le magasin', endsAt: at(2 * DAY) }).expect(201)).body;
    expect(promo.kind).toBe('promo');
    const ev = (await post(owner, org.id, { kind: 'event', title: 'Inauguration', body: 'Venez nombreux', startsAt: at(DAY), endsAt: at(DAY + 3600_000), place: 'Gombe' }).expect(201)).body;
    expect(ev).toMatchObject({ kind: 'event', place: 'Gombe' });

    const edited = (await ctx.http.patch(`/v1/orgs/${org.id}/updates/${p.id}`).set(bearer(owner.token)).send({ title: 'Titre modifié' }).expect(200)).body;
    expect(edited).toMatchObject({ title: 'Titre modifié', body: p.body });
    await ctx.http.patch(`/v1/orgs/${org.id}/updates/${p.id}`).set(bearer(owner.token)).send({}).expect(400);

    const staff = (await ctx.http.get(`/v1/orgs/${org.id}/updates`).set(bearer(owner.token)).expect(200)).body;
    expect(staff.items.map((i: { id: string }) => i.id)).toEqual([ev.id, promo.id, p.id]);

    const { rows } = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE metadata->>'orgId' = $1 AND action LIKE 'org.update_%' ORDER BY id`, [org.id]);
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['org.update_created', 'org.update_created', 'org.update_created', 'org.update_changed']);
    expect(JSON.stringify(rows)).not.toContain('SECRETTEXT');
    expect(JSON.stringify(rows)).not.toContain('Inauguration');
    expect(rows[0].metadata).toMatchObject({ updateId: p.id, kind: 'post' });
  });

  it('validates events and dates, also on edit', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    await post(owner, org.id, { kind: 'event', title: 'X', body: 'Y' }).expect(400);
    await post(owner, org.id, { kind: 'event', title: 'X', body: 'Y', startsAt: at(DAY), endsAt: at(DAY) }).expect(400);
    await post(owner, org.id, { kind: 'promo', title: 'X', body: 'Y', startsAt: at(DAY), endsAt: at(0) }).expect(400);
    await post(owner, org.id, { kind: 'post', title: 'x'.repeat(81), body: 'Y' }).expect(400);
    await post(owner, org.id, { kind: 'post', title: 'X', body: 'y'.repeat(1001) }).expect(400);
    await post(owner, org.id, { kind: 'post', title: 'X', body: 'Y', startsAt: 'demain' }).expect(400);
    await post(owner, org.id, { kind: 'other', title: 'X', body: 'Y' }).expect(400);
    const ev = (await post(owner, org.id, { kind: 'event', title: 'X', body: 'Y', startsAt: at(DAY) }).expect(201)).body;
    // Clearing the start of an event, or moving the end before the start, is refused on the merged result.
    await ctx.http.patch(`/v1/orgs/${org.id}/updates/${ev.id}`).set(bearer(owner.token)).send({ startsAt: null }).expect(400);
    await ctx.http.patch(`/v1/orgs/${org.id}/updates/${ev.id}`).set(bearer(owner.token)).send({ endsAt: at(0) }).expect(400);
    await ctx.http.patch(`/v1/orgs/${org.id}/updates/${ev.id}`).set(bearer(owner.token)).send({ kind: 'post', startsAt: null }).expect(200);
  });

  it('shows publicly without a token: live items only, events first by date, then newest first; paginates', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const mk = async (b: Record<string, unknown>) => (await post(owner, org.id, b).expect(201)).body.id as string;
    const oldPost = await mk({ kind: 'post', title: 'Ancienne', body: 'a' });
    const newPost = await mk({ kind: 'post', title: 'Récente', body: 'b' });
    const livePromo = await mk({ kind: 'promo', title: 'Promo en cours', body: 'c', endsAt: at(DAY) });
    const openPromo = await mk({ kind: 'promo', title: 'Promo sans fin', body: 'd' });
    const expiredPromo = await mk({ kind: 'promo', title: 'Promo finie', body: 'e' });
    const lateEvent = await mk({ kind: 'event', title: 'Plus tard', body: 'f', startsAt: at(5 * DAY) });
    const soonEvent = await mk({ kind: 'event', title: 'Bientôt', body: 'g', startsAt: at(DAY) });
    const ongoing = await mk({ kind: 'event', title: 'En cours', body: 'h', startsAt: at(-3600_000), endsAt: at(3600_000) });
    const pastEvent = await mk({ kind: 'event', title: 'Passé', body: 'i', startsAt: at(-3 * DAY), endsAt: at(-2 * DAY) });
    const pastOpen = await mk({ kind: 'event', title: 'Passé sans fin', body: 'j', startsAt: at(-3 * DAY) });
    const hidden = await mk({ kind: 'post', title: 'Masquée', body: 'k' });
    // created_at and expiry set directly: the API refuses past dates only through validation, not storage.
    await ctx.sql.query(`UPDATE org_updates SET created_at = now() - interval '10 days' WHERE id = $1`, [oldPost]);
    await ctx.sql.query(`UPDATE org_updates SET starts_at = now() - interval '3 days', ends_at = now() - interval '1 day' WHERE id = $1`, [expiredPromo]);
    await ctx.sql.query(`UPDATE org_updates SET hidden = true WHERE id = $1`, [hidden]);

    const res = await pub(org.slug).expect(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual([ongoing, soonEvent, lateEvent, openPromo, livePromo, newPost, oldPost].map((x) => x));
    expect(ids).not.toContain(expiredPromo);
    expect(ids).not.toContain(pastEvent);
    expect(ids).not.toContain(pastOpen);
    expect(ids).not.toContain(hidden);
    expect(res.body.nextCursor).toBeNull();

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await pub(org.slug, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      seen.push(...page.body.items.map((i) => i.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(ids);
    await pub(org.slug, '?cursor=garbage').expect(400);

    // Staff still see hidden and finished items.
    const staff = (await ctx.http.get(`/v1/orgs/${org.id}/updates?limit=100`).set(bearer(owner.token)).expect(200)).body.items;
    expect(staff).toHaveLength(11);
    expect(staff.find((i: { id: string }) => i.id === hidden).hidden).toBe(true);
  });

  it('answers 404 for a private, suspended or unknown organisation', async () => {
    const owner = await user();
    const priv = await createOrg(owner, { visibility: 'private' });
    const susp = await createOrg(owner);
    await post(owner, priv.id, { kind: 'post', title: 'X', body: 'Y' }).expect(201);
    await post(owner, susp.id, { kind: 'post', title: 'X', body: 'Y' }).expect(201);
    await ctx.sql.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [susp.id]);
    await pub(priv.slug).expect(404);
    await pub(susp.slug).expect(404);
    await pub('inconnue-zzz').expect(404);
  });

  it('refuses a role without org.profile.edit (403) and non-members (404)', async () => {
    const owner = await user();
    const emp = await user();
    const stranger = await user();
    const org = await createOrg(owner);
    await addMember(org.id, owner, emp, 'employee');
    const one = (await post(owner, org.id, { kind: 'post', title: 'X', body: 'Y' }).expect(201)).body;
    await post(emp, org.id, { kind: 'post', title: 'X', body: 'Y' }).expect(403);
    await ctx.http.patch(`/v1/orgs/${org.id}/updates/${one.id}`).set(bearer(emp.token)).send({ title: 'Z' }).expect(403);
    await ctx.http.delete(`/v1/orgs/${org.id}/updates/${one.id}`).set(bearer(emp.token)).expect(403);
    await ctx.http.get(`/v1/orgs/${org.id}/updates`).set(bearer(emp.token)).expect(200);
    await ctx.http.get(`/v1/orgs/${org.id}/updates`).set(bearer(stranger.token)).expect(404);
    await post(stranger, org.id, { kind: 'post', title: 'X', body: 'Y' }).expect(404);
  });

  it('caps an organisation at 50 updates (409)', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    await ctx.sql.query(
      `INSERT INTO org_updates (org_id, kind, title, body) SELECT $1::uuid, 'post', 'n' || g, 'b' FROM generate_series(1, 50) g`,
      [org.id],
    );
    const res = await post(owner, org.id, { kind: 'post', title: 'X', body: 'Y' }).expect(409);
    expect(res.body.error.details).toMatchObject({ reason: 'limit', limit: 50 });
  });

  it('deletes an update; unknown or foreign ids are 404; audited', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const other = await createOrg(await user());
    const one = (await post(owner, org.id, { kind: 'promo', title: 'X', body: 'Y' }).expect(201)).body;
    await ctx.http.delete(`/v1/orgs/${other.id}/updates/${one.id}`).set(bearer(owner.token)).expect(404);
    await ctx.http.delete(`/v1/orgs/${org.id}/updates/${randomUUID()}`).set(bearer(owner.token)).expect(404);
    await ctx.http.delete(`/v1/orgs/${org.id}/updates/pas-un-uuid`).set(bearer(owner.token)).expect(404);
    await ctx.http.patch(`/v1/orgs/${org.id}/updates/${randomUUID()}`).set(bearer(owner.token)).send({ title: 'Z' }).expect(404);
    await ctx.http.delete(`/v1/orgs/${org.id}/updates/${one.id}`).set(bearer(owner.token)).expect(204);
    expect((await pub(org.slug).expect(200)).body.items).toHaveLength(0);
    const { rows } = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'org.update_deleted' AND metadata->>'orgId' = $1`, [org.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ updateId: one.id, kind: 'promo' });
  });

  it('can be reported and hidden by a moderator; the hidden item leaves the public list', async () => {
    const owner = await user();
    const reader = await user();
    const mod = await user(['user', 'moderator']);
    const org = await createOrg(owner);
    const one = (await post(owner, org.id, { kind: 'post', title: 'Spam', body: 'Y' }).expect(201)).body;
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'org_update', targetId: one.id, reason: 'spam' }).expect(201);
    await ctx.http.post('/v1/admin/moderation/actions').set(bearer(mod.token)).send({ targetType: 'org_update', targetId: one.id, action: 'hide' }).expect(200);
    expect((await pub(org.slug).expect(200)).body.items).toHaveLength(0);
    expect((await ctx.http.get(`/v1/orgs/${org.id}/updates`).set(bearer(owner.token)).expect(200)).body.items[0].hidden).toBe(true);
    // A hidden item can no longer be reported by outsiders.
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'org_update', targetId: one.id, reason: 'spam' }).expect(404);
  });
});
