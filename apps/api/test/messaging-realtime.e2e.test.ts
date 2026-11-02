import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConversationMembersService } from '../src/messaging/members.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
let port: number;
const sockets: Socket[] = [];

beforeAll(async () => {
  ctx = await createTestContext({ REALTIME_SESSION_RECHECK_SECONDS: '0' });
  await ctx.app.listen(0, '127.0.0.1');
  port = (ctx.app.getHttpServer().address() as AddressInfo).port;
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
  pushToken: string;
}

async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  const pushToken = `ExponentPushToken[${randomUUID().replace(/-/g, '')}]`;
  await ctx.http.put('/v1/me/push-tokens').set(bearer(tokens.accessToken)).send({ token: pushToken, platform: 'android' }).expect(204);
  return { token: tokens.accessToken, id: me.body.id, pushToken };
}

async function open(u: TU): Promise<Socket> {
  const s = connectClient(`http://127.0.0.1:${port}`, {
    path: '/v1/socket.io',
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: { token: u.token },
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', (e) => reject(e));
  });
  return s;
}

const nextEvent = <T = any>(s: Socket, event: string, ms = 2000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${event}`)), ms);
    s.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });

/** Resolves true if no such event arrives within `ms`. */
const silent = (s: Socket, event: string, ms = 400) =>
  new Promise<boolean>((resolve) => {
    const onEvent = () => resolve(false);
    s.once(event, onEvent);
    setTimeout(() => {
      s.off(event, onEvent);
      resolve(true);
    }, ms);
  });

const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function direct(a: TU, b: TU): Promise<string> {
  const res = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id });
  expect([200, 201]).toContain(res.status);
  return res.body.id;
}

async function group(owner: TU, members: TU[], title = 'Équipe'): Promise<string> {
  const res = await ctx.http
    .post('/v1/conversations')
    .set(bearer(owner.token))
    .send({ kind: 'group', title, memberIds: members.map((m) => m.id) })
    .expect(201);
  return res.body.id;
}

const send = (u: TU, convId: string, body: Record<string, unknown> = {}) =>
  ctx.http
    .post(`/v1/conversations/${convId}/messages`)
    .set(bearer(u.token))
    .send({ clientId: randomUUID(), kind: 'text', body: 'Bonjour', ...body });

describe('messaging over sockets', () => {
  it('joins existing conversations on connection and delivers message.new', async () => {
    const [a, b] = [await user(), await user()];
    const conv = await direct(a, b);
    const sb = await open(b);
    const got = nextEvent(sb, 'message.new');
    const sent = await send(a, conv, { body: 'salut B' }).expect(201);
    const ev = await got;
    expect(ev).toMatchObject({ id: sent.body.id, conversationId: conv, body: 'salut B', myReaction: null });
  });

  it('puts the members of a group created after the connection in its room, and only them', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const [sa, sb, sc] = [await open(a), await open(b), await open(c)];
    const gotB = nextEvent(sb, 'message.new');
    const noneC = silent(sc, 'message.new');
    const g = await group(a, [b]);
    // The creation event itself reaches the members.
    expect((await gotB).systemEvent).toMatchObject({ type: 'group_created' });
    expect(await noneC).toBe(true);

    const next = nextEvent(sb, 'message.new');
    const noneC2 = silent(sc, 'message.new');
    await send(a, g, { body: 'premier' }).expect(201);
    expect((await next).body).toBe('premier');
    expect(await noneC2).toBe(true);
    expect(sa.connected).toBe(true);
  });

  it('stops delivering to a removed member, even if the post-commit events fail', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const g = await group(a, [b, c]);
    const [sb, sc] = [await open(b), await open(c)];

    const removedEvent = nextEvent(sb, 'conversation.member_removed');
    await ctx.http.delete(`/v1/conversations/${g}/members/${b.id}`).set(bearer(a.token)).expect(204);
    expect((await removedEvent).userId).toBe(b.id);
    const none = silent(sb, 'message.new');
    const gotC = nextEvent(sc, 'message.new');
    await send(a, g, { body: 'sans B' }).expect(201);
    expect((await gotC).body).toBe('sans B');
    expect(await none).toBe(true);

    // The events failing after the commit must neither fail the request nor keep the socket in the room.
    const d = await user();
    await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(a.token)).send({ userIds: [d.id] }).expect(201);
    const sd = await open(d);
    vi.spyOn(ConversationMembersService.prototype as any, 'emitAfter').mockRejectedValue(new Error('boom'));
    await ctx.http.delete(`/v1/conversations/${g}/members/${d.id}`).set(bearer(a.token)).expect(204);
    const noneD = silent(sd, 'message.new');
    await send(a, g, { body: 'sans D' }).expect(201);
    expect(await noneD).toBe(true);
  });

  it('hides lastReadSeq in receipt.updated when readReceipts is off', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const g = await group(a, [b, c]);
    await ctx.http.patch('/v1/me/privacy').set(bearer(b.token)).send({ readReceipts: false }).expect(200);
    const sa = await open(a);
    const sent = await send(a, g, { body: 'lu ?' }).expect(201);
    const seq = sent.body.seq as number;

    const hidden = nextEvent(sa, 'receipt.updated');
    await ctx.http.post(`/v1/conversations/${g}/read`).set(bearer(b.token)).send({ seq }).expect(200);
    const evB = await hidden;
    expect(evB).toMatchObject({ conversationId: g, userId: b.id, lastReadSeq: null });

    const shown = nextEvent(sa, 'receipt.updated');
    await ctx.http.post(`/v1/conversations/${g}/read`).set(bearer(c.token)).send({ seq }).expect(200);
    expect(await shown).toMatchObject({ userId: c.id, lastReadSeq: seq });
  });

  it('pushes a generic body to unmuted members, nothing to muted unmentioned ones', async () => {
    const [a, b, c, d] = [await user(), await user(), await user(), await user()];
    const g = await group(a, [b, c, d]);
    const mute = new Date(Date.now() + 3_600_000).toISOString();
    await ctx.http.patch(`/v1/conversations/${g}/me`).set(bearer(c.token)).send({ mutedUntil: mute }).expect(200);
    await ctx.http.patch(`/v1/conversations/${g}/me`).set(bearer(d.token)).send({ mutedUntil: mute }).expect(200);

    ctx.push.sent.length = 0;
    await send(a, g, { body: 'secret très privé', mentions: [d.id] }).expect(201);
    await pause(500);
    const mine = ctx.push.sent.filter((m) => [a, b, c, d].some((u) => u.pushToken === m.to));
    expect(mine.map((m) => m.to).sort()).toEqual([b.pushToken, d.pushToken].sort());
    for (const m of mine) {
      expect(m.title).toBe('Équipe');
      expect(JSON.stringify(m)).not.toContain('privé');
      expect(JSON.stringify(m)).not.toContain('secret');
    }
  });

  it('relays typing between members only', async () => {
    const [a, b, o] = [await user(), await user(), await user()];
    const g = await group(a, [b]);
    const [sa, sb, so] = [await open(a), await open(b), await open(o)];
    const got = nextEvent(sa, 'typing');
    sb.emit('typing', { conversationId: g });
    expect(await got).toEqual({ conversationId: g, userId: b.id });

    // An outsider cannot type into the room, nor name another room through the payload.
    const noneA = silent(sa, 'typing');
    so.emit('typing', { conversationId: g });
    so.emit('typing', { conversationId: `${g}\nconversation:other` });
    expect(await noneA).toBe(true);
    const noneO = silent(so, 'typing');
    await pause(2100);
    sb.emit('typing', { conversationId: g });
    expect(await noneO).toBe(true);
  });
});

describe('message send rate limit', () => {
  it('answers 429 once the messaging budget is spent, on the send route only', async () => {
    const limited = await createTestContext({ MESSAGING_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const mk = async () => {
        const { tokens } = await signUp(limited);
        const me = await limited.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
        return { token: tokens.accessToken, id: me.body.id as string };
      };
      const [a, b] = [await mk(), await mk()];
      const conv = await limited.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id }).expect(201);
      const post = () =>
        limited.http
          .post(`/v1/conversations/${conv.body.id}/messages`)
          .set(bearer(a.token))
          .send({ clientId: randomUUID(), kind: 'text', body: 'x' });
      for (let i = 0; i < 3; i++) await post().expect(201);
      const refused = await post();
      expect(refused.status).toBe(429);
      expect(refused.body.error.code).toBe('rate_limited');
      // Reading is not counted against the messaging budget.
      await limited.http.get(`/v1/conversations/${conv.body.id}/messages`).set(bearer(a.token)).expect(200);
    } finally {
      await limited.close();
    }
  });
});

describe('account export cap', () => {
  it('keeps the 10 000 most recent sent messages and flags the truncation', async () => {
    const [a, b] = [await user(), await user()];
    const conv = await direct(a, b);
    await send(a, conv, { body: 'LE PLUS ANCIEN' }).expect(201);
    const small = await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200);
    expect(small.body.messagesSentTruncated).toBe(false);
    expect(small.body.messagesSent).toHaveLength(1);

    await ctx.sql.query(
      `INSERT INTO messages (conversation_id, seq, sender_id, kind, client_id, body, created_at)
       SELECT $1, 1 + g, $2, 'text', gen_random_uuid(), 'm' || g, now() + g * interval '1 millisecond'
       FROM generate_series(1, 10000) g`,
      [conv, a.id],
    );
    const res = await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200);
    expect(res.body.messagesSentTruncated).toBe(true);
    expect(res.body.messagesSent).toHaveLength(10000);
    expect(res.body.messagesSent.some((m: { body: string }) => m.body === 'LE PLUS ANCIEN')).toBe(false);
    expect(res.body.messagesSent[0].body).toBe('m1');
    expect(res.body.messagesSent[9999].body).toBe('m10000');
  }, 60_000);
});

// Error logging: see exception-filter.test.ts.
