import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, type TestContext } from './helpers.js';
import { creatorKit } from './creator-helpers.js';

let ctx: TestContext;
let kit: ReturnType<typeof creatorKit>;
beforeAll(async () => {
  ctx = await createTestContext();
  kit = creatorKit(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const send = (token: string, attachment: unknown, body?: string) =>
  ctx.http.post('/v1/posts').set(bearer(token)).send({ clientId: randomUUID(), visibility: 'public', body, attachment });

describe('post attachments', () => {
  it('stores a location and an event, with no text needed', async () => {
    const u = await kit.user();
    const loc = await send(u.token, { type: 'location', lat: -1.67, lng: 29.22, label: 'Goma' }).expect(201);
    expect(loc.body.attachment).toEqual({ type: 'location', lat: -1.67, lng: 29.22, label: 'Goma' });
    const ev = await send(u.token, { type: 'event', title: 'Concert', startsAt: '2030-01-01T18:00:00.000Z', place: 'Stade' }, 'Venez').expect(201);
    expect(ev.body.attachment).toMatchObject({ type: 'event', title: 'Concert', place: 'Stade' });
    const got = await ctx.http.get(`/v1/posts/${ev.body.id}`).set(bearer(u.token)).expect(200);
    expect(got.body.attachment.title).toBe('Concert');
  });

  it('rejects a one-choice poll and a bad coordinate', async () => {
    const u = await kit.user();
    await send(u.token, { type: 'poll', options: ['seul'] }, 'Q').expect(400);
    await send(u.token, { type: 'poll', options: ['a', 'b'] }).expect(400);
    await send(u.token, { type: 'location', lat: 200, lng: 0, label: 'x' }).expect(400);
  });

  it('counts poll votes, one per person and changeable', async () => {
    const author = await kit.user();
    const voter = await kit.user();
    const p = await send(author.token, { type: 'poll', options: ['Oui', 'Non', 'Peut-être'] }, 'On y va ?').expect(201);
    expect(p.body.attachment.options.map((o: { votes: number }) => o.votes)).toEqual([0, 0, 0]);
    const vote = (token: string, option: number) => ctx.http.put(`/v1/posts/${p.body.id}/poll-vote`).set(bearer(token)).send({ option });
    expect((await vote(voter.token, 1).expect(200)).body.attachment).toMatchObject({ myVote: 1 });
    const again = await vote(voter.token, 2).expect(200);
    expect(again.body.attachment.options.map((o: { votes: number }) => o.votes)).toEqual([0, 0, 1]);
    await vote(author.token, 0).expect(200);
    await vote(voter.token, 3).expect(400);
    const noPoll = await kit.post(author);
    await ctx.http.put(`/v1/posts/${noPoll}/poll-vote`).set(bearer(author.token)).send({ option: 0 }).expect(400);
  });
});

describe('popular creators', () => {
  it('ranks active authors by followers, without me or blocked accounts', async () => {
    const me = await kit.user();
    const star = await kit.user();
    const fan = await kit.user();
    const blocked = await kit.user();
    await kit.post(star);
    await kit.post(blocked);
    await kit.post(me);
    await kit.follow(fan, star);
    await kit.block(me, blocked);
    const res = await ctx.http.get('/v1/creators/popular').set(bearer(me.token)).expect(200);
    const ids = res.body.items.map((i: { userId: string }) => i.userId);
    expect(ids).toContain(star.id);
    expect(ids).not.toContain(me.id);
    expect(ids).not.toContain(blocked.id);
    expect(res.body.items.find((i: { userId: string }) => i.userId === star.id)).toMatchObject({ followersCount: 1, postsCount: 1 });
  });
});
