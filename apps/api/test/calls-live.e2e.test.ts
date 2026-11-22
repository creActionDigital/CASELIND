import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
interface TU {
  token: string;
  id: string;
}
const user = async (): Promise<TU> => {
  const token = (await signUp(ctx)).tokens.accessToken;
  return { token, id: (await ctx.http.get('/v1/me').set(bearer(token)).expect(200)).body.id };
};
const post = (u: TU, path: string, body?: object) => ctx.http.post(path).set(bearer(u.token)).send(body ?? {});
const get = (u: TU, path: string) => ctx.http.get(path).set(bearer(u.token));
const direct = async (a: TU, b: TU): Promise<string> => (await post(a, '/v1/conversations', { kind: 'direct', userId: b.id }).expect(201)).body.id;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('calls', () => {
  it('rings, is answered, relays signalling and ends; history lists it', async () => {
    const a = await user();
    const b = await user();
    const cid = await direct(a, b);
    const call = (await post(a, `/v1/conversations/${cid}/calls`, { kind: 'video' }).expect(201)).body;
    expect(call).toMatchObject({ status: 'ringing', callerId: a.id, calleeId: b.id, kind: 'video', answeredAt: null });
    // The caller cannot answer their own call; the callee can.
    await post(a, `/v1/calls/${call.id}/accept`).expect(403);
    const active = (await post(b, `/v1/calls/${call.id}/accept`).expect(200)).body;
    expect(active.status).toBe('active');
    expect(active.answeredAt).not.toBeNull();
    await post(a, `/v1/calls/${call.id}/signal`, { type: 'offer', payload: '{"sdp":"x"}' }).expect(204);
    await post(b, `/v1/calls/${call.id}/signal`, { type: 'bogus', payload: 'x' }).expect(400);
    await post(b, `/v1/calls/${call.id}/accept`).expect(409);
    const ended = (await post(b, `/v1/calls/${call.id}/end`).expect(200)).body;
    expect(ended.status).toBe('ended');
    await post(a, `/v1/calls/${call.id}/signal`, { type: 'ice', payload: 'x' }).expect(409);
    expect((await get(a, '/v1/me/calls').expect(200)).body.items.map((c: { id: string }) => c.id)).toContain(call.id);
  });

  it('serves ICE servers to a signed-in user and refuses signalling from a stranger', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const ice = (await get(a, '/v1/calls/ice-servers').expect(200)).body;
    expect(ice.iceServers[0].urls[0]).toMatch(/^stun:/);
    expect(ice.iceServers[1]).toMatchObject({ username: expect.any(String), credential: expect.any(String) });
    await ctx.http.get('/v1/calls/ice-servers').expect(401);
    const call = (await post(a, `/v1/conversations/${await direct(a, b)}/calls`, { kind: 'audio' }).expect(201)).body;
    await post(c, `/v1/calls/${call.id}/signal`, { type: 'ice', payload: '{}' }).expect(404);
    await post(b, `/v1/calls/${call.id}/signal`, { type: 'ice', payload: '{}' }).expect(204);
  });

  it('decline, cancel, busy, expiry and access rules', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    const cid = await direct(a, b);
    await post(c, `/v1/conversations/${cid}/calls`, { kind: 'audio' }).expect(404); // not a member
    await post(a, `/v1/conversations/${cid}/calls`, { kind: 'phone' }).expect(400);
    const first = (await post(a, `/v1/conversations/${cid}/calls`, { kind: 'audio' }).expect(201)).body;
    await post(b, `/v1/conversations/${cid}/calls`, { kind: 'audio' }).expect(409); // busy
    await get(c, '/v1/me/calls').expect(200);
    await post(c, `/v1/calls/${first.id}/end`).expect(404); // stranger
    await post(a, `/v1/calls/${first.id}/decline`).expect(403); // only the callee declines
    expect((await post(b, `/v1/calls/${first.id}/decline`).expect(200)).body.status).toBe('declined');
    const second = (await post(a, `/v1/conversations/${cid}/calls`, { kind: 'audio' }).expect(201)).body;
    expect((await post(a, `/v1/calls/${second.id}/end`).expect(200)).body.status).toBe('cancelled');
    // Unanswered for more than 45 s: missed, and the callee cannot answer it any more.
    const third = (await post(a, `/v1/conversations/${cid}/calls`, { kind: 'audio' }).expect(201)).body;
    await ctx.sql.query(`UPDATE calls SET created_at = now() - interval '2 minutes' WHERE id = $1`, [third.id]);
    await post(b, `/v1/calls/${third.id}/accept`).expect(409);
    expect((await get(a, '/v1/me/calls').expect(200)).body.items.find((x: { id: string }) => x.id === third.id).status).toBe('missed');
    // A blocked user cannot be called; a group is not callable.
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await post(a, `/v1/conversations/${cid}/calls`, { kind: 'audio' }).expect(403);
    const g = (await post(c, '/v1/conversations', { kind: 'group', title: 'Groupe', memberIds: [a.id] }).expect(201)).body.id;
    await post(c, `/v1/conversations/${g}/calls`, { kind: 'audio' }).expect(409);
    await ctx.http.post(`/v1/calls/${first.id}/end`).expect(401);
  });
});

describe('lives', () => {
  it('start, join, chat, signalling, leave and end', async () => {
    const host = await user();
    const v1 = await user();
    const v2 = await user();
    const live = (await post(host, '/v1/lives', { title: 'Cuisine en direct' }).expect(201)).body;
    expect(live).toMatchObject({ status: 'live', viewers: 0, hostId: host.id });
    await post(host, '/v1/lives', { title: 'Second' }).expect(409); // one at a time
    await post(host, '/v1/lives', { title: '' }).expect(400);
    expect((await get(v1, '/v1/lives').expect(200)).body.items.map((l: { id: string }) => l.id)).toContain(live.id);

    await get(v1, `/v1/lives/${live.id}/messages`).expect(409); // not in the live yet
    await post(v1, `/v1/lives/${live.id}/messages`, { body: 'salut' }).expect(409);
    expect((await post(v1, `/v1/lives/${live.id}/join`).expect(200)).body.viewers).toBe(1);
    expect((await post(v1, `/v1/lives/${live.id}/join`).expect(200)).body.viewers).toBe(1); // idempotent
    expect((await post(v2, `/v1/lives/${live.id}/join`).expect(200)).body.viewers).toBe(2);
    await post(v1, `/v1/lives/${live.id}/messages`, { body: 'Bonjour !' }).expect(201);
    await post(host, `/v1/lives/${live.id}/messages`, { body: 'Bienvenue' }).expect(201);
    await post(v1, `/v1/lives/${live.id}/messages`, { body: 'x'.repeat(301) }).expect(400);
    const chat = (await get(v2, `/v1/lives/${live.id}/messages`).expect(200)).body.items;
    expect(chat.map((m: { body: string }) => m.body)).toEqual(['Bonjour !', 'Bienvenue']);

    await post(v1, `/v1/lives/${live.id}/signal`, { type: 'offer', payload: '{}' }).expect(204);
    await post(host, `/v1/lives/${live.id}/signal`, { type: 'answer', payload: '{}', to: v1.id }).expect(204);
    await post(host, `/v1/lives/${live.id}/signal`, { type: 'answer', payload: '{}' }).expect(404); // `to` required
    await post(host, `/v1/lives/${live.id}/signal`, { type: 'answer', payload: '{}', to: host.id }).expect(404);

    await post(v1, `/v1/lives/${live.id}/leave`).expect(204);
    expect((await get(host, `/v1/lives/${live.id}`).expect(200)).body).toMatchObject({ viewers: 1, peakViewers: 2 });
    await post(v1, `/v1/lives/${live.id}/end`).expect(403); // only the host ends it
    expect((await post(host, `/v1/lives/${live.id}/end`).expect(200)).body.status).toBe('ended');
    await post(v2, `/v1/lives/${live.id}/join`).expect(409);
    await post(host, `/v1/lives/${live.id}/messages`, { body: 'encore ?' }).expect(409);
    expect((await get(v1, '/v1/lives').expect(200)).body.items.map((l: { id: string }) => l.id)).not.toContain(live.id);
    await post(host, '/v1/lives', { title: 'Nouveau live' }).expect(201); // free again
  });

  it('hides a live from a blocked user, 404 for unknown ids, 401 without session', async () => {
    const host = await user();
    const v = await user();
    const live = (await post(host, '/v1/lives', { title: 'Privé' }).expect(201)).body;
    await ctx.http.put(`/v1/blocks/${v.id}`).set(bearer(host.token)).expect(204);
    await post(v, `/v1/lives/${live.id}/join`).expect(404);
    await get(v, `/v1/lives/${live.id}`).expect(404);
    expect((await get(v, '/v1/lives').expect(200)).body.items.map((l: { id: string }) => l.id)).not.toContain(live.id);
    await get(v, '/v1/lives/not-a-uuid').expect(404);
    await ctx.http.get('/v1/lives').expect(401);
  });
});
