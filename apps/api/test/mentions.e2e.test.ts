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
  pushToken: string;
}
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  const pushToken = `ExponentPushToken[${randomUUID().replace(/-/g, '')}]`;
  await ctx.http.put('/v1/me/push-tokens').set(bearer(tokens.accessToken)).send({ token: pushToken, platform: 'android' }).expect(204);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle, pushToken };
}
async function group(owner: TU, members: TU[]): Promise<string> {
  return (await ctx.http.post('/v1/conversations').set(bearer(owner.token)).send({ kind: 'group', title: 'Equipe', memberIds: members.map((m) => m.id) }).expect(201)).body.id;
}
const send = (u: TU, conv: string, body: string, mentions?: string[]) =>
  ctx.http.post(`/v1/conversations/${conv}/messages`).set(bearer(u.token)).send({ clientId: randomUUID(), kind: 'text', body, ...(mentions && { mentions }) });
const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const pushesTo = (u: TU) => ctx.push.sent.filter((m) => m.to === u.pushToken);
const mute = (u: TU, conv: string) =>
  ctx.http.patch(`/v1/conversations/${conv}/me`).set(bearer(u.token)).send({ mutedUntil: new Date(Date.now() + 3_600_000).toISOString() }).expect(200);

describe('mentions', () => {
  it('stores the mentioned members of the conversation, nobody else', async () => {
    const [a, b, c, outsider] = [await user(), await user(), await user(), await user()];
    const g = await group(a, [b, c]);
    const ok = await send(a, g, `@${b.handle} tu peux regarder ?`, [b.id, b.id.toUpperCase()]).expect(201);
    expect(ok.body.mentions).toEqual([b.id]);
    const listed = (await ctx.http.get(`/v1/conversations/${g}/messages`).set(bearer(c.token)).expect(200)).body.items;
    expect(listed.find((m: any) => m.id === ok.body.id).mentions).toEqual([b.id]);

    await send(a, g, `@${outsider.handle} salut`, [outsider.id]).expect(400);
    // A member who left can no longer be mentioned.
    await ctx.http.delete(`/v1/conversations/${g}/members/${c.id}`).set(bearer(a.token)).expect(204);
    await send(a, g, `@${c.handle}`, [c.id]).expect(400);
    // Without mentions the array is empty.
    expect((await send(a, g, 'pas de mention').expect(201)).body.mentions).toEqual([]);
  });

  it('notifies the mentioned member with a generic text even when the conversation is muted, never with the content', async () => {
    const [a, b, c, d] = [await user(), await user(), await user(), await user()];
    const g = await group(a, [b, c, d]);
    await mute(c, g);
    await mute(d, g);
    ctx.push.sent.length = 0;
    await send(a, g, 'secret très privé', [d.id]).expect(201);
    await pause(600);
    expect(pushesTo(b).map((m) => m.body)).toEqual(['Nouveau message']);
    expect(pushesTo(c)).toHaveLength(0); // muted and not mentioned
    const mentioned = pushesTo(d);
    expect(mentioned).toHaveLength(1);
    expect(mentioned[0]!.body).toBe('Vous avez été mentionné(e)');
    expect(JSON.stringify(ctx.push.sent)).not.toContain('secret');
    expect(pushesTo(a)).toHaveLength(0);
  });

  it('respects quiet mode and blocks', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const g = await group(a, [b, c]);
    await mute(b, g);
    await mute(c, g);
    // b is in quiet mode: the mention does not break through.
    await ctx.http.patch('/v1/me/notification-preferences').set(bearer(b.token)).send({ quietUntil: new Date(Date.now() + 3_600_000).toISOString() }).expect(200);
    // c blocked the author: nothing for c either.
    await ctx.http.put(`/v1/blocks/${a.id}`).set(bearer(c.token)).expect(204);
    ctx.push.sent.length = 0;
    await send(a, g, 'coucou', [b.id, c.id]).expect(201);
    await pause(600);
    expect(pushesTo(b)).toHaveLength(0);
    expect(pushesTo(c)).toHaveLength(0);
  });
});
