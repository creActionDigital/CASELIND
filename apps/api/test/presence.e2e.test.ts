import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

async function direct(a: TU, b: TU): Promise<string> {
  const res = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id });
  return res.body.id;
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

const nextEvent = <T = any>(s: Socket, event: string, ms = 3000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${event}`)), ms);
    s.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });

const silent = (s: Socket, event: string, ms = 600) =>
  new Promise<boolean>((resolve) => {
    const onEvent = () => resolve(false);
    s.once(event, onEvent);
    setTimeout(() => {
      s.off(event, onEvent);
      resolve(true);
    }, ms);
  });

const presence = (viewer: TU, subject: string) => ctx.http.get(`/v1/presence/${subject}`).set(bearer(viewer.token));
const setShow = (u: TU, showPresence: boolean) => ctx.http.patch('/v1/me/privacy').set(bearer(u.token)).send({ showPresence });

const HIDDEN = { visible: false, online: false, lastSeenAt: null };

describe('presence', () => {
  it('is on by default, shows online while a socket is connected, then last seen', async () => {
    const [a, b] = [await user(), await user()];
    expect((await ctx.http.get('/v1/me/privacy').set(bearer(a.token)).expect(200)).body.showPresence).toBe(true);
    await direct(a, b);
    const before = (await presence(a, b.id).expect(200)).body;
    expect(before).toMatchObject({ userId: b.id, visible: true, online: false });

    const watcher = await open(a);
    const update = nextEvent(watcher, 'presence.updated');
    const sb = await open(b);
    expect(await update).toMatchObject({ userId: b.id, visible: true, online: true });
    expect((await presence(a, b.id).expect(200)).body).toMatchObject({ visible: true, online: true });

    const gone = nextEvent(watcher, 'presence.updated');
    sb.close();
    expect(await gone).toMatchObject({ userId: b.id, visible: true, online: false });
    const after = (await presence(a, b.id).expect(200)).body;
    expect(after.online).toBe(false);
    expect(Date.parse(after.lastSeenAt)).not.toBeNaN();
  });

  it('is reciprocal: hiding yours hides theirs, and nobody sees the hider', async () => {
    const [a, b] = [await user(), await user()];
    await direct(a, b);
    const sb = await open(b);
    expect((await presence(a, b.id).expect(200)).body.online).toBe(true);

    await setShow(a, false).expect(200);
    expect((await presence(a, b.id).expect(200)).body).toMatchObject({ userId: b.id, ...HIDDEN });
    expect((await presence(b, a.id).expect(200)).body).toMatchObject({ userId: a.id, ...HIDDEN });

    await setShow(a, true).expect(200);
    expect((await presence(a, b.id).expect(200)).body).toMatchObject({ visible: true, online: true });
    sb.close();
  });

  it('tells connected peers when the setting changes, and never tells a hider', async () => {
    const [a, b] = [await user(), await user()];
    await direct(a, b);
    const sa = await open(a);
    const sb = await open(b);
    const hid = nextEvent(sb, 'presence.updated');
    await setShow(a, false).expect(200);
    expect(await hid).toMatchObject({ userId: a.id, ...HIDDEN });
    // b hides too: a's coming and going is no longer pushed to b.
    await setShow(b, false).expect(200);
    const quiet = silent(sb, 'presence.updated');
    const sa2 = await open(a);
    await setShow(a, true).expect(200);
    expect(await quiet).toBe(true);
    sa.close();
    sa2.close();
  });

  it('is limited to active direct conversations and refused across blocks', async () => {
    const [a, b, stranger, c] = [await user(), await user(), await user(), await user()];
    await direct(a, b);
    expect((await presence(stranger, b.id).expect(200)).body).toMatchObject({ userId: b.id, ...HIDDEN });
    expect((await presence(a, a.id).expect(200)).body.visible).toBe(false);
    // A shared group is not enough.
    const g = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'group', title: 'G', memberIds: [c.id] }).expect(201);
    expect(g.body.id).toBeTruthy();
    expect((await presence(a, c.id).expect(200)).body.visible).toBe(false);
    await presence(a, 'not-a-uuid').expect(404);
    await ctx.http.get(`/v1/presence/${b.id}`).expect(401);

    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    expect((await presence(a, b.id).expect(200)).body.visible).toBe(false);
    expect((await presence(b, a.id).expect(200)).body.visible).toBe(false);
    await ctx.http.delete(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    expect((await presence(a, b.id).expect(200)).body.visible).toBe(true);
    void randomUUID;
  });

  it('does not push to a blocked peer', async () => {
    const [a, b] = [await user(), await user()];
    await direct(a, b);
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    const wb = await open(b);
    const quiet = silent(wb, 'presence.updated');
    await open(a);
    expect(await quiet).toBe(true);
  });
});
