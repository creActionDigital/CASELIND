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
  const slug = `quest-${Date.now().toString(36)}-${++n}`;
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: 'Boutique Questions', kind: 'shop', ...extra }).expect(201);
  return { id: res.body.id, slug: res.body.slug };
}

async function addMember(orgId: string, owner: TU, m: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(owner.token)).send({ handle: m.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(m.token)).expect(200);
}

const ask = (u: TU, orgId: string, question: string) => ctx.http.post('/v1/me/org-questions').set(bearer(u.token)).send({ orgId, question });
const answer = (u: TU, orgId: string, id: string, a = 'Oui, ouvert le dimanche') => ctx.http.post(`/v1/orgs/${orgId}/questions/${id}/answer`).set(bearer(u.token)).send({ answer: a });
const pub = (slug: string, q = '') => ctx.http.get(`/v1/public/orgs/${slug}/questions${q}`);
const notifCount = async (u: TU) => (await ctx.sql.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [u.id])).rows[0].n as number;

describe('org questions', () => {
  it('asks, notifies the organisation, answers publicly, notifies the author; audit and notifications carry no text', async () => {
    const owner = await user();
    const admin = await user();
    const emp = await user();
    const visitor = await user();
    const org = await createOrg(owner);
    await addMember(org.id, owner, admin, 'admin');
    await addMember(org.id, owner, emp, 'employee');
    const [ownerBefore, adminBefore, empBefore] = [await notifCount(owner), await notifCount(admin), await notifCount(emp)];

    await ask(visitor, org.id, '').expect(400);
    await ask(visitor, org.id, 'x'.repeat(301)).expect(400);
    await ctx.http.post('/v1/me/org-questions').send({ orgId: org.id, question: 'Salut' }).expect(401);
    const q = (await ask(visitor, org.id, '  Ouvert le dimanche SECRETQ ?  ').expect(201)).body;
    expect(q).toMatchObject({ question: 'Ouvert le dimanche SECRETQ ?', answer: null, answeredAt: null, hidden: false, org: { id: org.id, slug: org.slug } });
    expect([await notifCount(owner) - ownerBefore, await notifCount(admin) - adminBefore, await notifCount(emp) - empBefore]).toEqual([1, 1, 0]);

    // Unanswered: private to the author and the organisation.
    expect((await pub(org.slug).expect(200)).body.items).toHaveLength(0);
    expect((await ctx.http.get('/v1/me/org-questions').set(bearer(visitor.token)).expect(200)).body.items.map((i: { id: string }) => i.id)).toEqual([q.id]);
    const pending = (await ctx.http.get(`/v1/orgs/${org.id}/questions`).set(bearer(emp.token)).expect(200)).body.items;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: q.id, asker: { userId: visitor.id, handle: visitor.handle } });

    await answer(emp, org.id, q.id).expect(403);
    await answer(admin, org.id, q.id, '').expect(400);
    await answer(admin, org.id, q.id, 'x'.repeat(1001)).expect(400);
    await answer(admin, org.id, randomUUID()).expect(404);
    await answer(admin, org.id, 'pas-un-uuid').expect(404);
    const visitorBefore = await notifCount(visitor);
    await answer(admin, org.id, q.id, 'Oui REPONSESECRETE').expect(204);
    expect(await notifCount(visitor)).toBe(visitorBefore + 1);
    // Editing the answer does not notify again.
    await answer(admin, org.id, q.id, 'Oui, de 9h à 17h').expect(204);
    expect(await notifCount(visitor)).toBe(visitorBefore + 1);

    const listed = (await pub(org.slug).expect(200)).body.items;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: q.id, question: 'Ouvert le dimanche SECRETQ ?', answer: 'Oui, de 9h à 17h' });
    expect(Object.keys(listed[0]).sort()).toEqual(['answer', 'answeredAt', 'createdAt', 'id', 'question']);
    expect((await ctx.http.get(`/v1/orgs/${org.id}/questions`).set(bearer(admin.token)).expect(200)).body.items).toHaveLength(0);
    expect((await ctx.http.get(`/v1/orgs/${org.id}/questions?status=answered`).set(bearer(admin.token)).expect(200)).body.items).toHaveLength(1);
    expect((await ctx.http.get('/v1/me/org-questions').set(bearer(visitor.token)).expect(200)).body.items[0].answer).toBe('Oui, de 9h à 17h');

    const notifs = await ctx.sql.query(`SELECT title, body FROM notifications WHERE user_id = ANY($1::uuid[])`, [[owner.id, admin.id, visitor.id]]);
    expect(JSON.stringify(notifs.rows)).not.toContain('SECRETQ');
    expect(JSON.stringify(notifs.rows)).not.toContain('REPONSESECRETE');
    const { rows } = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE metadata->>'orgId' = $1 AND action LIKE 'org.question_%' ORDER BY id`, [org.id]);
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['org.question_asked', 'org.question_answered', 'org.question_answered']);
    expect(JSON.stringify(rows)).not.toContain('SECRETQ');
    expect(JSON.stringify(rows)).not.toContain('REPONSESECRETE');
    expect(rows[0].metadata).toMatchObject({ questionId: q.id });
  });

  it('paginates the public list, newest answer first', async () => {
    const owner = await user();
    const visitor = await user();
    const org = await createOrg(owner);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const q = (await ask(visitor, org.id, `Question ${i}`).expect(201)).body;
      await answer(owner, org.id, q.id, `Réponse ${i}`).expect(204);
      ids.unshift(q.id);
    }
    const all = (await pub(org.slug).expect(200)).body;
    expect(all.items.map((i: { id: string }) => i.id)).toEqual(ids);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await pub(org.slug, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      seen.push(...page.body.items.map((i) => i.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(ids);
    await pub(org.slug, '?cursor=garbage').expect(400);
  });

  it('caps an account at 5 questions per day (409 rate_limited), per account', async () => {
    const owner = await user();
    const visitor = await user();
    const other = await user();
    const org = await createOrg(owner);
    for (let i = 0; i < 5; i++) await ask(visitor, org.id, `Q${i}`).expect(201);
    const res = await ask(visitor, org.id, 'Q5').expect(409);
    expect(res.body.error.details).toMatchObject({ reason: 'rate_limited', limit: 5 });
    await ask(other, org.id, 'Autre compte').expect(201);
    // Older than 24 hours no longer counts.
    await ctx.sql.query(`UPDATE org_questions SET created_at = now() - interval '25 hours' WHERE asker_user_id = $1 AND question = 'Q0'`, [visitor.id]);
    await ask(visitor, org.id, 'Q6').expect(201);
  });

  it('refuses members, blocked pairs (404), private and unknown organisations', async () => {
    const owner = await user();
    const emp = await user();
    const visitor = await user();
    const org = await createOrg(owner);
    const priv = await createOrg(owner, { visibility: 'private' });
    await addMember(org.id, owner, emp, 'employee');
    expect((await ask(emp, org.id, 'Moi ?').expect(403)).body.error.details.reason).toBe('member');
    expect((await ask(owner, org.id, 'Moi ?').expect(403)).body.error.details.reason).toBe('member');
    await ask(visitor, priv.id, 'Privé ?').expect(404);
    await ask(visitor, randomUUID(), 'Inconnue ?').expect(404);
    await ctx.http.post('/v1/me/org-questions').set(bearer(visitor.token)).send({ orgId: 'pas-un-uuid', question: 'x' }).expect(400);
    await pub(priv.slug).expect(404);
    await pub('inconnue-zzz').expect(404);

    // A block with any member of the organisation, either way, refuses without telling why.
    await ctx.http.put(`/v1/blocks/${visitor.id}`).set(bearer(owner.token)).expect(204);
    await ask(visitor, org.id, 'Bloqué ?').expect(404);
    const other = await user();
    await ctx.http.put(`/v1/blocks/${emp.id}`).set(bearer(other.token)).expect(204);
    await ask(other, org.id, 'Bloqué aussi ?').expect(404);
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM org_questions WHERE org_id = $1`, [org.id])).rows[0].n).toBe(0);
  });

  it('lets staff delete a question; others get 403 or 404', async () => {
    const owner = await user();
    const emp = await user();
    const stranger = await user();
    const visitor = await user();
    const org = await createOrg(owner);
    await addMember(org.id, owner, emp, 'employee');
    const q = (await ask(visitor, org.id, 'À supprimer').expect(201)).body;
    const del = (u: TU, id: string) => ctx.http.delete(`/v1/orgs/${org.id}/questions/${id}`).set(bearer(u.token));
    await del(emp, q.id).expect(403);
    await del(stranger, q.id).expect(404);
    await del(owner, randomUUID()).expect(404);
    await del(owner, 'pas-un-uuid').expect(404);
    await ctx.http.get(`/v1/orgs/${org.id}/questions`).set(bearer(stranger.token)).expect(404);
    await del(owner, q.id).expect(204);
    await del(owner, q.id).expect(404);
    expect((await ctx.http.get('/v1/me/org-questions').set(bearer(visitor.token)).expect(200)).body.items).toHaveLength(0);
    const { rows } = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'org.question_deleted' AND metadata->>'orgId' = $1`, [org.id]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('À supprimer');
  });

  it('can be reported once answered and hidden by a moderator; the hidden question leaves every list', async () => {
    const owner = await user();
    const visitor = await user();
    const reader = await user();
    const mod = await user(['user', 'moderator']);
    const org = await createOrg(owner);
    const q = (await ask(visitor, org.id, 'Spam').expect(201)).body;
    // Unanswered: not visible to outsiders, so not reportable by them.
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'org_question', targetId: q.id, reason: 'spam' }).expect(404);
    await answer(owner, org.id, q.id).expect(204);
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'org_question', targetId: q.id, reason: 'spam' }).expect(201);
    await ctx.http.post('/v1/admin/moderation/actions').set(bearer(mod.token)).send({ targetType: 'org_question', targetId: q.id, action: 'hide' }).expect(200);
    expect((await pub(org.slug).expect(200)).body.items).toHaveLength(0);
    expect((await ctx.http.get(`/v1/orgs/${org.id}/questions?status=all`).set(bearer(owner.token)).expect(200)).body.items).toHaveLength(0);
    await answer(owner, org.id, q.id, 'Encore').expect(404);
    // The author still sees it, flagged hidden.
    expect((await ctx.http.get('/v1/me/org-questions').set(bearer(visitor.token)).expect(200)).body.items[0]).toMatchObject({ id: q.id, hidden: true });
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'org_question', targetId: q.id, reason: 'spam' }).expect(404);
  });

  it('exports the own questions with their answer', async () => {
    const owner = await user();
    const visitor = await user();
    const org = await createOrg(owner);
    const q = (await ask(visitor, org.id, 'Livrez-vous ?').expect(201)).body;
    await answer(owner, org.id, q.id, 'Oui').expect(204);
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(visitor.token)).expect(200)).body;
    expect(exp.orgFeedback.questions).toEqual([expect.objectContaining({ id: q.id, orgName: 'Boutique Questions', question: 'Livrez-vous ?', answer: 'Oui' })]);
    expect((await ctx.http.get('/v1/me/export').set(bearer(owner.token)).expect(200)).body.orgFeedback.questions).toEqual([]);
  });
});
