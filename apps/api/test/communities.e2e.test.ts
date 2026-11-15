import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ MESSAGING_GROUP_MAX_MEMBERS: '3' });
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
}
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id };
}
async function group(owner: TU, title: string, members: TU[] = []): Promise<string> {
  const res = await ctx.http.post('/v1/conversations').set(bearer(owner.token)).send({ kind: 'group', title, memberIds: members.map((m) => m.id) }).expect(201);
  return res.body.id;
}
const publish = (u: TU, id: string, body: Record<string, unknown>) => ctx.http.put(`/v1/conversations/${id}/community`).set(bearer(u.token)).send(body);
const list = (u: TU, qs = '') => ctx.http.get(`/v1/communities${qs}`).set(bearer(u.token));
const join = (u: TU, id: string) => ctx.http.post(`/v1/communities/${id}/join`).set(bearer(u.token));

describe('communities (lot 14)', () => {
  it('only a group owner can publish; a private group is not listed', async () => {
    const owner = await user();
    const other = await user();
    const g = await group(owner, 'Privé uniquement');
    expect((await list(other, '?q=Privé')).body.items).toEqual([]);
    await publish(other, g, {}).expect(404); // not a member
    const member = await user();
    const g2 = await group(owner, 'Avec membre', [member]);
    await publish(member, g2, {}).expect(403); // member, not owner
    await publish(owner, g2, { tags: ['a'] }).expect(400); // tag too short
    await publish(owner, g2, { tags: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] }).expect(400); // more than 5
  });

  it('publishes, lists, filters by tag and text, and shows the viewer joined flag', async () => {
    const owner = await user();
    const viewer = await user();
    const g = await group(owner, 'Design Goma');
    const pub = (await publish(owner, g, { description: 'Parlons design', tags: ['Design', 'design', 'Finance'] }).expect(200)).body;
    expect(pub).toMatchObject({ conversationId: g, title: 'Design Goma', description: 'Parlons design', tags: ['design', 'finance'], memberCount: 1, joined: true });
    expect((await list(viewer, '?tag=design')).body.items.map((c: { conversationId: string }) => c.conversationId)).toContain(g);
    expect((await list(viewer, '?tag=inconnu')).body.items).toEqual([]);
    const found = (await list(viewer, '?q=design%20goma')).body.items;
    expect(found).toHaveLength(1);
    expect(found[0].joined).toBe(false);
    expect((await list(viewer, '?q=%25')).body.items).toEqual([]); // wildcard is escaped
    const tags = (await ctx.http.get('/v1/communities/tags').set(bearer(viewer.token)).expect(200)).body.items;
    expect(tags.find((t: { tag: string }) => t.tag === 'design').communities).toBeGreaterThanOrEqual(1);
    await list(viewer, '?cursor=abc').expect(400);
  });

  it('joins (idempotent), sees only later messages, and the member count follows', async () => {
    const owner = await user();
    const joiner = await user();
    const g = await group(owner, 'Ouverte');
    await ctx.http.post(`/v1/conversations/${g}/messages`).set(bearer(owner.token)).send({ clientId: crypto.randomUUID(), kind: 'text', body: 'avant' }).expect(201);
    await join(joiner, g).expect(404); // not published yet
    await publish(owner, g, { tags: ['ouvert'] }).expect(200);
    const first = (await join(joiner, g).expect(200)).body;
    expect(first).toMatchObject({ joined: true, memberCount: 2 });
    expect((await join(joiner, g).expect(200)).body.memberCount).toBe(2);
    const msgs = (await ctx.http.get(`/v1/conversations/${g}/messages`).set(bearer(joiner.token)).expect(200)).body.items;
    expect(msgs.some((m: { body: string | null }) => m.body === 'avant')).toBe(false);
    const audit = await ctx.sql.query(`SELECT action FROM audit_events WHERE actor_user_id = $1 AND action = 'community.joined'`, [joiner.id]);
    expect(audit.rows).toHaveLength(1);
    await join(joiner, 'not-a-uuid').expect(404);
  });

  it('refuses when full, and keeps a removed member out until an admin re-adds them', async () => {
    const owner = await user();
    const [a, b, c] = [await user(), await user(), await user()];
    const g = await group(owner, 'Petite');
    await publish(owner, g, {}).expect(200);
    await join(a, g).expect(200);
    await join(b, g).expect(200); // 3 members: the limit
    const full = await join(c, g).expect(409);
    expect(full.body.error.details).toMatchObject({ reason: 'group_full' });
    await ctx.http.delete(`/v1/conversations/${g}/members/${b.id}`).set(bearer(owner.token)).expect(204);
    await join(b, g).expect(403); // removed by the owner: banned from the listing
    await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(owner.token)).send({ userIds: [b.id] }).expect(201);
    await ctx.http.delete(`/v1/conversations/${g}/members/${b.id}`).set(bearer(b.token)).expect(204); // leaves by choice
    await join(b, g).expect(200); // a re-add cleared the ban, leaving is not a ban
  });

  it('unpublishing keeps the group but removes it from the listing', async () => {
    const owner = await user();
    const viewer = await user();
    const g = await group(owner, 'Éphémère');
    await publish(owner, g, {}).expect(200);
    await ctx.http.delete(`/v1/conversations/${g}/community`).set(bearer(viewer.token)).expect(404);
    await ctx.http.delete(`/v1/conversations/${g}/community`).set(bearer(owner.token)).expect(204);
    expect((await list(viewer, '?q=phémère')).body.items).toEqual([]);
    await join(viewer, g).expect(404);
    await ctx.http.get(`/v1/conversations/${g}`).set(bearer(owner.token)).expect(200);
  });
});
