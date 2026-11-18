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
}

async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id };
}

async function group(owner: TU, members: TU[]): Promise<string> {
  const res = await ctx.http
    .post('/v1/conversations')
    .set(bearer(owner.token))
    .send({ kind: 'group', title: 'Famille', memberIds: members.map((m) => m.id) })
    .expect(201);
  return res.body.id;
}

async function direct(a: TU, b: TU): Promise<string> {
  const res = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id });
  return res.body.id;
}

const poll = (u: TU, convId: string, body: Record<string, unknown> = {}) =>
  ctx.http
    .post(`/v1/conversations/${convId}/polls`)
    .set(bearer(u.token))
    .send({ clientId: randomUUID(), question: 'On mange où ?', options: ['Chez Mama', 'Maquis', 'Pizza'], ...body });

const vote = (u: TU, messageId: string, optionIds: string[]) =>
  ctx.http.put(`/v1/messages/${messageId}/poll/vote`).set(bearer(u.token)).send({ optionIds });

const close = (u: TU, messageId: string) => ctx.http.post(`/v1/messages/${messageId}/poll/close`).set(bearer(u.token));

const count = (res: { body: any }) => res.body.poll.options.map((o: { votes: number }) => o.votes);

describe('polls', () => {
  it('creates a poll message, idempotent per clientId, and lists it with counters', async () => {
    const [a, b] = [await user(), await user()];
    const g = await group(a, [b]);
    const clientId = randomUUID();
    const created = await poll(a, g, { clientId }).expect(201);
    expect(created.body.kind).toBe('poll');
    expect(created.body.body).toBe('On mange où ?');
    expect(created.body.poll).toMatchObject({ question: 'On mange où ?', multiple: false, voters: 0, closed: false, closesAt: null, myVotes: [] });
    expect(created.body.poll.options.map((o: { label: string }) => o.label)).toEqual(['Chez Mama', 'Maquis', 'Pizza']);
    const replay = await poll(a, g, { clientId }).expect(200);
    expect(replay.body.id).toBe(created.body.id);

    const list = await ctx.http.get(`/v1/conversations/${g}/messages`).set(bearer(b.token)).expect(200);
    const m = list.body.items.find((x: { id: string }) => x.id === created.body.id);
    expect(m.poll.options).toHaveLength(3);
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'message.poll_created' AND actor_user_id = $1`, [a.id]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain('mange');
  });

  it('validates the request', async () => {
    const [a, b] = [await user(), await user()];
    const g = await group(a, [b]);
    await poll(a, g, { options: ['seule'] }).expect(400);
    await poll(a, g, { options: ['1', '2', '3', '4', '5', '6', '7'] }).expect(400);
    await poll(a, g, { options: ['oui', 'OUI'] }).expect(400);
    await poll(a, g, { options: ['oui', 'x'.repeat(81)] }).expect(400);
    await poll(a, g, { question: 'q'.repeat(201) }).expect(400);
    await poll(a, g, { question: '   ' }).expect(400);
    await poll(a, g, { closesAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
    await poll(a, g, { closesAt: new Date(Date.now() + 40 * 86400_000).toISOString() }).expect(400);
    await poll(a, g, { closesAt: new Date(Date.now() + 3600_000).toISOString() }).expect(201);
  });

  it('counts votes, lets a voter change or withdraw, keeps voters anonymous', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const g = await group(a, [b, c]);
    const m = (await poll(a, g).expect(201)).body;
    const [o1, o2, o3] = m.poll.options.map((o: { id: string }) => o.id);

    let r = await vote(b, m.id, [o1]).expect(200);
    expect(count(r)).toEqual([1, 0, 0]);
    expect(r.body.poll.myVotes).toEqual([o1]);
    r = await vote(c, m.id, [o1]).expect(200);
    expect(count(r)).toEqual([2, 0, 0]);
    // Changing: the previous vote moves.
    r = await vote(b, m.id, [o2]).expect(200);
    expect(count(r)).toEqual([1, 1, 0]);
    expect(r.body.poll.myVotes).toEqual([o2]);
    expect(r.body.poll.voters).toBe(2);
    // The creator sees counters, not names, and no votes of their own.
    const list = await ctx.http.get(`/v1/conversations/${g}/messages`).set(bearer(a.token)).expect(200);
    const seen = list.body.items.find((x: { id: string }) => x.id === m.id);
    expect(count({ body: seen })).toEqual([1, 1, 0]);
    expect(seen.poll.myVotes).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain(b.id);
    expect(JSON.stringify(seen)).not.toContain(c.id);
    // Withdrawing.
    r = await vote(b, m.id, []).expect(200);
    expect(count(r)).toEqual([1, 0, 0]);
    expect(r.body.poll.myVotes).toEqual([]);

    // Single choice rejects two options; unknown option and malformed ids too.
    await vote(b, m.id, [o1, o2]).expect(400);
    await vote(b, m.id, [randomUUID()]).expect(400);
    await vote(b, m.id, [o3, o3]).expect(200); // duplicates collapse
    await vote(b, m.id, ['nope']).expect(400);
  });

  it('accepts several options on a multiple-choice poll', async () => {
    const [a, b] = [await user(), await user()];
    const g = await group(a, [b]);
    const m = (await poll(a, g, { multiple: true }).expect(201)).body;
    const ids = m.poll.options.map((o: { id: string }) => o.id);
    const r = await vote(b, m.id, [ids[0], ids[2]]).expect(200);
    expect(count(r)).toEqual([1, 0, 1]);
    expect(r.body.poll.voters).toBe(1);
  });

  it('closes by the creator or a group admin only, then refuses votes; idempotent', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const g = await group(a, [b, c]);
    const m = (await poll(b, g).expect(201)).body; // b (member) creates
    const o1 = m.poll.options[0].id;
    await vote(c, m.id, [o1]).expect(200);
    await close(c, m.id).expect(403); // another plain member
    const closed = await close(b, m.id).expect(200);
    expect(closed.body.poll.closed).toBe(true);
    await close(b, m.id).expect(200);
    await vote(c, m.id, []).expect(409);
    const afterwards = await vote(c, m.id, [o1]);
    expect(afterwards.body.error.details.reason).toBe('poll_closed');
    // The final counters stay.
    const list = await ctx.http.get(`/v1/conversations/${g}/messages`).set(bearer(c.token)).expect(200);
    expect(count({ body: list.body.items.find((x: { id: string }) => x.id === m.id) })).toEqual([1, 0, 0]);

    // The group owner may close somebody else's poll.
    const m2 = (await poll(b, g).expect(201)).body;
    await close(a, m2.id).expect(200);
    const audit = await ctx.sql.query(`SELECT 1 FROM audit_events WHERE action = 'message.poll_closed'`);
    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses votes once the closing time has passed', async () => {
    const [a, b] = [await user(), await user()];
    const g = await group(a, [b]);
    const m = (await poll(a, g, { closesAt: new Date(Date.now() + 3600_000).toISOString() }).expect(201)).body;
    await ctx.sql.query(`UPDATE message_polls SET closes_at = now() - interval '1 minute' WHERE message_id = $1`, [m.id]);
    await vote(b, m.id, [m.poll.options[0].id]).expect(409);
    const list = await ctx.http.get(`/v1/conversations/${g}/messages`).set(bearer(b.token)).expect(200);
    expect(list.body.items.find((x: { id: string }) => x.id === m.id).poll.closed).toBe(true);
  });

  it('hides polls from non-members and former members, and respects firstSeq', async () => {
    const [a, b, outsider] = [await user(), await user(), await user()];
    const g = await group(a, [b]);
    const m = (await poll(a, g).expect(201)).body;
    const o1 = m.poll.options[0].id;
    await poll(outsider, g).expect(404);
    await vote(outsider, m.id, [o1]).expect(404);
    await close(outsider, m.id).expect(404);
    // Someone added later does not see the earlier poll.
    const late = await user();
    await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(a.token)).send({ userIds: [late.id] }).expect(201);
    await vote(late, m.id, [o1]).expect(404);
    // A member who left is no longer a member.
    await ctx.http.delete(`/v1/conversations/${g}/members/${b.id}`).set(bearer(b.token)).expect(204);
    await vote(b, m.id, [o1]).expect(404);
    // Not a poll.
    const text = await ctx.http.post(`/v1/conversations/${g}/messages`).set(bearer(a.token)).send({ clientId: randomUUID(), kind: 'text', body: 'salut' }).expect(201);
    await vote(a, text.body.id, [o1]).expect(404);
    await close(a, text.body.id).expect(404);
    await vote(a, 'not-a-uuid', [o1]).expect(404);
  });

  it('respects blocks in direct conversations and for the creator in a group', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const dm = await direct(a, b);
    const g = await group(a, [b, c]);
    const m = (await poll(a, dm).expect(201)).body;
    const o1 = m.poll.options[0].id;
    await vote(b, m.id, [o1]).expect(200);
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await vote(b, m.id, [o1]).expect(404);
    await poll(b, dm).expect(403);
    await poll(a, dm).expect(403);

    const gm = (await poll(a, g).expect(201)).body;
    await vote(c, gm.id, [gm.poll.options[0].id]).expect(200);
    await vote(b, gm.id, [gm.poll.options[0].id]).expect(404); // blocked either way with the creator
  });

  it('cannot be forwarded; recalling erases the poll and its votes', async () => {
    const [a, b] = [await user(), await user()];
    const g = await group(a, [b]);
    const m = (await poll(a, g).expect(201)).body;
    await vote(b, m.id, [m.poll.options[0].id]).expect(200);
    await ctx.http.post(`/v1/messages/${m.id}/forward`).set(bearer(a.token)).send({ conversationIds: [g], clientId: randomUUID() }).expect(400);
    await ctx.http.delete(`/v1/messages/${m.id}?scope=all`).set(bearer(a.token)).expect(204);
    const rows = await ctx.sql.query(`SELECT (SELECT count(*) FROM message_polls WHERE message_id = $1) AS p, (SELECT count(*) FROM message_poll_votes WHERE message_id = $1) AS v`, [m.id]);
    expect(rows.rows[0]).toEqual({ p: '0', v: '0' });
    await vote(b, m.id, [m.poll.options[0].id]).expect(409);
  });

  it('exports the polls created and the own votes (ids only)', async () => {
    const [a, b] = [await user(), await user()];
    const g = await group(a, [b]);
    const m = (await poll(a, g).expect(201)).body;
    const o1 = m.poll.options[0].id;
    await vote(b, m.id, [o1]).expect(200);
    const mine = await ctx.http.get('/v1/me/export').set(bearer(a.token));
    expect(mine.status).toBe(200);
    expect(mine.body.messaging.polls.map((p: { messageId: string }) => p.messageId)).toContain(m.id);
    expect(mine.body.messaging.pollVotes).toEqual([]);
    const theirs = await ctx.http.get('/v1/me/export').set(bearer(b.token)).expect(200);
    expect(theirs.body.messaging.pollVotes).toEqual([{ messageId: m.id, conversationId: g, optionIds: [o1] }]);
    expect(theirs.body.messaging.polls).toEqual([]);
  });
});
