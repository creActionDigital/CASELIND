import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConversationRoomsResolver, RealtimeService } from '../src/realtime/realtime.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
let port: number;
let realtime: RealtimeService;
const sockets: Socket[] = [];

beforeAll(async () => {
  ctx = await createTestContext({ REALTIME_SESSION_RECHECK_SECONDS: '0' });
  await ctx.app.listen(0, '127.0.0.1');
  port = (ctx.app.getHttpServer().address() as AddressInfo).port;
  realtime = ctx.app.get(RealtimeService);
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});
afterAll(async () => {
  await ctx.close();
});

function client(auth: Record<string, unknown> | undefined, query?: Record<string, string>, p = port): Socket {
  const s = connectClient(`http://127.0.0.1:${p}`, {
    path: '/v1/socket.io',
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth,
    query,
  });
  sockets.push(s);
  return s;
}

const connected = (s: Socket) =>
  new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', (e) => reject(e));
  });

const rejected = (s: Socket) =>
  new Promise<string>((resolve, reject) => {
    s.once('connect', () => reject(new Error('should not connect')));
    s.once('connect_error', (e) => resolve(e.message));
  });

const nextEvent = <T = unknown>(s: Socket, event: string, ms = 1500) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${event}`)), ms);
    s.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });

/** Resolves true if no such event arrives within `ms`. */
const silent = (s: Socket, event: string, ms = 300) =>
  new Promise<boolean>((resolve) => {
    const onEvent = () => resolve(false);
    s.once(event, onEvent);
    setTimeout(() => {
      s.off(event, onEvent);
      resolve(true);
    }, ms);
  });

const disconnected = (s: Socket, ms = 3000) =>
  new Promise<string>((resolve, reject) => {
    if (s.disconnected) return resolve('already');
    const t = setTimeout(() => reject(new Error('still connected')), ms);
    s.once('disconnect', (reason) => {
      clearTimeout(t);
      resolve(reason);
    });
  });

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function account() {
  const { identifier, tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { identifier, tokens, id: me.body.id as string };
}

async function open(a: { tokens: { accessToken: string } }): Promise<Socket> {
  const s = client({ token: a.tokens.accessToken });
  await connected(s);
  return s;
}

describe('handshake authentication', () => {
  it('refuses a connection without a token, with a bad token, or with the token only in the query', async () => {
    expect(await rejected(client(undefined))).toBe('unauthenticated');
    expect(await rejected(client({ token: 'not-a-jwt' }))).toBe('unauthenticated');
    const a = await account();
    expect(await rejected(client(undefined, { token: a.tokens.accessToken }))).toBe('unauthenticated');
  });

  it('refuses a token whose session was revoked and accepts a valid one', async () => {
    const a = await account();
    const s = await open(a);
    expect(s.connected).toBe(true);
    s.close();

    await ctx.http.post('/v1/auth/logout').set(bearer(a.tokens.accessToken)).expect(204);
    expect(await rejected(client({ token: a.tokens.accessToken }))).toBe('unauthenticated');
  });
});

describe('server to client fan-out', () => {
  it('delivers emitToUser only to that user', async () => {
    const a = await account();
    const b = await account();
    const sa = await open(a);
    const sb = await open(b);
    const got = nextEvent(sa, 'message.new');
    const none = silent(sb, 'message.new');
    realtime.emitToUser(a.id, 'message.new', { hello: 'a' });
    expect(await got).toEqual({ hello: 'a' });
    expect(await none).toBe(true);
  });

  it('joins no conversation room by default, then follows addToConversation / removeFromConversation', async () => {
    const a = await account();
    const b = await account();
    const sa = await open(a);
    const sb = await open(b);
    const conv = randomUUID();

    const none = silent(sa, 'message.updated');
    realtime.emitToConversation(conv, 'message.updated', { n: 0 });
    expect(await none).toBe(true);

    realtime.addToConversation([a.id], conv);
    await pause(100);
    const got = nextEvent(sa, 'message.updated');
    const notMember = silent(sb, 'message.updated');
    realtime.emitToConversation(conv, 'message.updated', { n: 1 });
    expect(await got).toEqual({ n: 1 });
    expect(await notMember).toBe(true);

    realtime.removeFromConversation(a.id, conv);
    await pause(100);
    const left = silent(sa, 'message.updated');
    realtime.emitToConversation(conv, 'message.updated', { n: 2 });
    expect(await left).toBe(true);
  });

  it('joins the conversations returned by the resolver on connection', async () => {
    const a = await account();
    const conv = randomUUID();
    const resolver = ctx.app.get(ConversationRoomsResolver);
    const original = resolver.conversationIdsFor.bind(resolver);
    resolver.conversationIdsFor = async (id: string) => (id === a.id ? [conv] : original(id));
    try {
      const s = await open(a);
      const got = nextEvent(s, 'message.new');
      realtime.emitToConversation(conv, 'message.new', { ok: true });
      expect(await got).toEqual({ ok: true });
    } finally {
      resolver.conversationIdsFor = original;
    }
  });
});

describe('typing', () => {
  it('relays to the other members of the room, not to the sender, and refuses outside the room', async () => {
    const a = await account();
    const b = await account();
    const c = await account();
    const sa = await open(a);
    const sb = await open(b);
    const sc = await open(c);
    const conv = randomUUID();
    realtime.addToConversation([a.id, b.id], conv);
    await pause(100);

    const gotB = nextEvent(sb, 'typing');
    const noEcho = silent(sa, 'typing');
    const noOutsider = silent(sc, 'typing');
    sa.emit('typing', { conversationId: conv });
    expect(await gotB).toEqual({ conversationId: conv, userId: a.id });
    expect(await noEcho).toBe(true);
    expect(await noOutsider).toBe(true);

    // The outsider cannot type into a conversation it is not part of.
    const noRelay = silent(sb, 'typing', 400);
    sc.emit('typing', { conversationId: conv });
    expect(await noRelay).toBe(true);
  });

  it('ignores invalid payloads and rate-limits to one event per two seconds per conversation', async () => {
    const a = await account();
    const b = await account();
    const sa = await open(a);
    const sb = await open(b);
    const conv = randomUUID();
    realtime.addToConversation([a.id, b.id], conv);
    await pause(100);

    const invalid = silent(sb, 'typing', 300);
    sa.emit('typing', { conversationId: 'nope' });
    sa.emit('typing', 42);
    sa.emit('typing');
    expect(await invalid).toBe(true);

    const received: unknown[] = [];
    sb.on('typing', (p) => received.push(p));
    sa.emit('typing', { conversationId: conv });
    sa.emit('typing', { conversationId: conv });
    sa.emit('typing', { conversationId: conv });
    await pause(400);
    expect(received).toHaveLength(1);
  });
});

describe('revocation closes sockets', () => {
  it('logout disconnects the socket of that session only', async () => {
    const a = await account();
    const second = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: a.identifier, password: PASSWORD, device: { platform: 'ios', name: 'Second' } })
      .expect(200);
    const s1 = await open(a);
    const s2 = await open({ tokens: second.body });
    const gone = disconnected(s1);
    await ctx.http.post('/v1/auth/logout').set(bearer(a.tokens.accessToken)).expect(204);
    expect(await gone).toBe('io server disconnect');
    expect(s2.connected).toBe(true);
  });

  it('revoking another session from the account disconnects that session', async () => {
    const a = await account();
    const second = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: a.identifier, password: PASSWORD, device: { platform: 'android', name: 'Other' } })
      .expect(200);
    const s2 = await open({ tokens: second.body });
    const s1 = await open(a);
    const gone = disconnected(s2);
    await ctx.http.delete(`/v1/auth/sessions/${second.body.sessionId}`).set(bearer(a.tokens.accessToken)).expect(204);
    await gone;
    expect(s1.connected).toBe(true);
  });

  it('password reset disconnects every socket of the account', async () => {
    const a = await account();
    const s = await open(a);
    const gone = disconnected(s);
    const forgot = await ctx.http.post('/v1/auth/password/forgot').send({ identifier: a.identifier }).expect(202);
    await ctx.http
      .post('/v1/auth/password/reset')
      .send({
        challengeId: forgot.body.challengeId,
        code: ctx.otp.lastCodeFor(a.identifier),
        newPassword: 'another-long-password-1',
      })
      .expect(204);
    await gone;
  });
});

describe('HTTP is unaffected by the non-HTTP guard bypass', () => {
  it('still enforces authentication on routes', async () => {
    await ctx.http.get('/v1/me').expect(401);
    const a = await account();
    await ctx.http.get('/v1/me').set(bearer(a.tokens.accessToken)).expect(200);
  });
});

describe('periodic session recheck', () => {
  it('disconnects sockets of a suspended account', async () => {
    const rctx = await createTestContext({ REALTIME_SESSION_RECHECK_SECONDS: '1' });
    try {
      await rctx.app.listen(0, '127.0.0.1');
      const p = (rctx.app.getHttpServer().address() as AddressInfo).port;
      const { tokens } = await signUp(rctx);
      const s = client({ token: tokens.accessToken }, undefined, p);
      await connected(s);
      const gone = disconnected(s, 5000);
      await rctx.sql.query(`UPDATE users SET status = 'suspended'`);
      expect(await gone).toBe('io server disconnect');
    } finally {
      await rctx.close();
    }
  });
});
