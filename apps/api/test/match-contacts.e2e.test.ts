import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ CONTACT_MATCH_RATE_LIMIT_PER_MINUTE: '6' });
});
afterAll(async () => {
  await ctx.close();
});

let n = 0;
const phone = () => `+2438${String(Date.now()).slice(-6)}${String(++n).padStart(2, '0')}`;
async function user(discoverable: boolean, name = 'Contact') {
  const p = phone();
  const { tokens } = await signUp(ctx, p, name);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (discoverable) await ctx.http.patch('/v1/me/privacy').set(bearer(tokens.accessToken)).send({ discoverableByPhone: true }).expect(200);
  return { token: tokens.accessToken, id: me.body.id as string, handle: me.body.handle as string, phone: p };
}
const match = (token: string, phones: string[]) => ctx.http.post('/v1/users/match-contacts').set(bearer(token)).send({ phones });

describe('POST /v1/users/match-contacts', () => {
  it('returns discoverable users only, with id, handle, name and avatar; excludes non-discoverable, blocked and self', async () => {
    const me = await user(true, 'Moi');
    const open = await user(true, 'Ouvert');
    const closed = await user(false, 'Ferme');
    const blocked = await user(true, 'Bloque');
    await ctx.http.put(`/v1/blocks/${blocked.id}`).set(bearer(me.token)).expect(204);
    const res = await match(me.token, [open.phone, closed.phone, blocked.phone, me.phone, '+243999000111']).expect(200);
    expect(res.body.items).toEqual([{ id: open.id, handle: open.handle, displayName: 'Ouvert', avatarUrl: null }]);
  });

  it('rejects more than 500 numbers, malformed numbers and anonymous callers', async () => {
    const me = await user(false);
    await match(me.token, Array.from({ length: 501 }, (_, i) => `+24381${String(i).padStart(7, '0')}`)).expect(400);
    await match(me.token, ['0812345678']).expect(400);
    await ctx.http.post('/v1/users/match-contacts').send({ phones: ['+243812345678'] }).expect(401);
  });

  it('has its own strict rate limit', async () => {
    const me = await user(false);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await match(me.token, ['+243812345678'])).status);
    expect(codes).toContain(429);
  });
});
