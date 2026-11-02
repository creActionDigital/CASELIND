import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
let notifications: NotificationsService;

beforeAll(async () => {
  ctx = await createTestContext();
  notifications = ctx.app.get(NotificationsService);
});
beforeEach(() => {
  ctx.push.sent.length = 0;
  ctx.push.failures.clear();
  ctx.push.throwOnSend = null;
});
afterAll(async () => {
  await ctx.close();
});

const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const newToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '')}]`;

async function account() {
  const { identifier, tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { identifier, tokens, token: tokens.accessToken, id: me.body.id as string };
}

async function register(token: string, pushToken: string, platform = 'android') {
  return ctx.http.put('/v1/me/push-tokens').set(bearer(token)).send({ token: pushToken, platform });
}

async function tokenCount(userId: string): Promise<number> {
  const { rows } = await ctx.sql.query('SELECT count(*)::int AS n FROM push_tokens WHERE user_id = $1', [userId]);
  return rows[0].n;
}

describe('push tokens', () => {
  it('registers idempotently, validates the token, and unregisters only its own', async () => {
    const a = await account();
    const b = await account();
    const t = newToken();
    await register(a.token, t).then((r) => expect(r.status).toBe(204));
    await register(a.token, t).then((r) => expect(r.status).toBe(204));
    expect(await tokenCount(a.id)).toBe(1);

    expect((await register(a.token, 'not-an-expo-token')).status).toBe(400);
    expect((await register(a.token, t, 'windows')).status).toBe(400);
    await ctx.http.put('/v1/me/push-tokens').send({ token: t, platform: 'ios' }).expect(401);

    // Someone else cannot remove it.
    await ctx.http.post('/v1/me/push-tokens/unregister').set(bearer(b.token)).send({ token: t }).expect(204);
    expect(await tokenCount(a.id)).toBe(1);
    await ctx.http.post('/v1/me/push-tokens/unregister').set(bearer(a.token)).send({ token: t }).expect(204);
    expect(await tokenCount(a.id)).toBe(0);
  });

  it('re-attaches a token to the new account and its current session', async () => {
    const a = await account();
    const b = await account();
    const t = newToken();
    await register(a.token, t);
    await register(b.token, t);
    expect(await tokenCount(a.id)).toBe(0);
    const { rows } = await ctx.sql.query('SELECT user_id, session_id FROM push_tokens WHERE token = $1', [t]);
    expect(rows).toEqual([{ user_id: b.id, session_id: b.tokens.sessionId }]);
  });

  it('keeps at most 10 tokens per user, dropping the oldest', async () => {
    const a = await account();
    const all = Array.from({ length: 12 }, newToken);
    for (const t of all) await register(a.token, t, 'ios');
    expect(await tokenCount(a.id)).toBe(10);
    const { rows } = await ctx.sql.query('SELECT token FROM push_tokens WHERE user_id = $1', [a.id]);
    const kept = rows.map((r) => r.token);
    expect(kept).not.toContain(all[0]);
    expect(kept).not.toContain(all[1]);
    expect(kept).toContain(all[11]);
  });
});

describe('notification centre', () => {
  it('lists, counts, reads one, reads all, and hides other users notifications', async () => {
    const a = await account();
    const b = await account();
    for (let i = 0; i < 3; i++) {
      await notifications.notify({ userId: a.id, category: 'social', title: `t${i}`, body: 'b', data: { k: 'v' } });
    }
    await notifications.notify({ userId: b.id, category: 'system', title: 'for b', body: 'b' });

    const list = await ctx.http.get('/v1/notifications').set(bearer(a.token)).expect(200);
    expect(list.body.items.map((n: { title: string }) => n.title)).toEqual(['t2', 't1', 't0']);
    expect(list.body.items[0]).toMatchObject({ category: 'social', body: 'b', data: { k: 'v' }, readAt: null });
    expect(list.body.nextCursor).toBeNull();
    expect((await ctx.http.get('/v1/notifications/unread-count').set(bearer(a.token)).expect(200)).body).toEqual({
      count: 3,
    });

    const first = list.body.items[0].id as string;
    await ctx.http.post(`/v1/notifications/${first}/read`).set(bearer(a.token)).expect(204);
    await ctx.http.post(`/v1/notifications/${first}/read`).set(bearer(a.token)).expect(204);
    expect((await ctx.http.get('/v1/notifications/unread-count').set(bearer(a.token))).body.count).toBe(2);
    const unread = await ctx.http.get('/v1/notifications?unreadOnly=true').set(bearer(a.token)).expect(200);
    expect(unread.body.items).toHaveLength(2);

    // Another user's notification, or garbage, is a 404.
    const bList = await ctx.http.get('/v1/notifications').set(bearer(b.token)).expect(200);
    await ctx.http.post(`/v1/notifications/${bList.body.items[0].id}/read`).set(bearer(a.token)).expect(404);
    await ctx.http.post(`/v1/notifications/${randomUUID()}/read`).set(bearer(a.token)).expect(404);
    await ctx.http.post('/v1/notifications/garbage/read').set(bearer(a.token)).expect(404);
    expect((await ctx.http.get('/v1/notifications/unread-count').set(bearer(b.token))).body.count).toBe(1);

    await ctx.http.post('/v1/notifications/read-all').set(bearer(a.token)).expect(204);
    expect((await ctx.http.get('/v1/notifications/unread-count').set(bearer(a.token))).body.count).toBe(0);
    expect((await ctx.http.get('/v1/notifications/unread-count').set(bearer(b.token))).body.count).toBe(1);
    await ctx.http.get('/v1/notifications').expect(401);
  });

  it('paginates with a cursor and rejects a malformed one', async () => {
    const a = await account();
    await notifications.notifyMany(
      Array.from({ length: 5 }, (_, i) => ({ userId: a.id, category: 'system' as const, title: `n${i}`, body: 'b' })),
    );
    const p1 = await ctx.http.get('/v1/notifications?limit=2').set(bearer(a.token)).expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toEqual(expect.any(String));
    const p2 = await ctx.http
      .get(`/v1/notifications?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`)
      .set(bearer(a.token))
      .expect(200);
    const p3 = await ctx.http
      .get(`/v1/notifications?limit=2&cursor=${encodeURIComponent(p2.body.nextCursor)}`)
      .set(bearer(a.token))
      .expect(200);
    expect(p3.body.nextCursor).toBeNull();
    const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((n: { id: string }) => n.id);
    expect(new Set(ids).size).toBe(5);
    await ctx.http.get('/v1/notifications?cursor=nope').set(bearer(a.token)).expect(400);
  });

  it('persist:false sends a push without a centre row', async () => {
    const a = await account();
    await register(a.token, newToken());
    await notifications.notify({ userId: a.id, category: 'message', title: 'Bob', body: 'secret text', persist: false });
    await vi.waitFor(() => expect(ctx.push.sent).toHaveLength(1));
    expect((await ctx.http.get('/v1/notifications/unread-count').set(bearer(a.token))).body.count).toBe(0);
  });
});

describe('push delivery and preferences', () => {
  it('has defaults and validates updates (security can never be disabled)', async () => {
    const a = await account();
    const defaults = await ctx.http.get('/v1/me/notification-preferences').set(bearer(a.token)).expect(200);
    expect(defaults.body).toEqual({ pushDisabledCategories: [], quietUntil: null, messagePreviews: false });

    const until = new Date(Date.now() + 3_600_000).toISOString();
    const res = await ctx.http
      .patch('/v1/me/notification-preferences')
      .set(bearer(a.token))
      .send({ pushDisabledCategories: ['social', 'social'], quietUntil: until, messagePreviews: true })
      .expect(200);
    expect(res.body).toEqual({ pushDisabledCategories: ['social'], quietUntil: until, messagePreviews: true });
    const cleared = await ctx.http
      .patch('/v1/me/notification-preferences')
      .set(bearer(a.token))
      .send({ quietUntil: null })
      .expect(200);
    expect(cleared.body).toEqual({ pushDisabledCategories: ['social'], quietUntil: null, messagePreviews: true });

    await ctx.http
      .patch('/v1/me/notification-preferences')
      .set(bearer(a.token))
      .send({ pushDisabledCategories: ['security'] })
      .expect(400);
    await ctx.http.patch('/v1/me/notification-preferences').set(bearer(a.token)).send({}).expect(400);
  });

  it('honours category opt-out, still delivers security, and still persists the row', async () => {
    const a = await account();
    const t = newToken();
    await register(a.token, t);
    await ctx.http
      .patch('/v1/me/notification-preferences')
      .set(bearer(a.token))
      .send({ pushDisabledCategories: ['social'] })
      .expect(200);

    await notifications.notify({ userId: a.id, category: 'social', title: 'muted', body: 'b' });
    await notifications.notify({ userId: a.id, category: 'security', title: 'alert', body: 'b' });
    await vi.waitFor(() => expect(ctx.push.sent.map((m) => m.title)).toContain('alert'));
    await pause();
    expect(ctx.push.sent.map((m) => m.title)).toEqual(['alert']);
    expect(ctx.push.sent[0]).toMatchObject({ to: t });
    expect((await ctx.http.get('/v1/notifications/unread-count').set(bearer(a.token))).body.count).toBe(2);
  });

  it('quiet mode blocks pushes except urgent ones', async () => {
    const a = await account();
    await register(a.token, newToken());
    await ctx.http
      .patch('/v1/me/notification-preferences')
      .set(bearer(a.token))
      .send({ quietUntil: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(200);
    await notifications.notify({ userId: a.id, category: 'system', title: 'calm', body: 'b' });
    await notifications.notify({ userId: a.id, category: 'system', title: 'loud', body: 'b', urgent: true });
    await vi.waitFor(() => expect(ctx.push.sent).toHaveLength(1));
    await pause();
    expect(ctx.push.sent.map((m) => m.title)).toEqual(['loud']);
    expect(ctx.push.sent[0]!.urgent).toBe(true);
  });

  it('hides message text in pushes unless previews are enabled', async () => {
    const a = await account();
    await register(a.token, newToken());
    await notifications.notify({ userId: a.id, category: 'message', title: 'Bob', body: 'private words', persist: false });
    await vi.waitFor(() => expect(ctx.push.sent).toHaveLength(1));
    expect(ctx.push.sent[0]!.body).not.toContain('private');
    await ctx.http.patch('/v1/me/notification-preferences').set(bearer(a.token)).send({ messagePreviews: true }).expect(200);
    await notifications.notify({ userId: a.id, category: 'message', title: 'Bob', body: 'private words', persist: false });
    await vi.waitFor(() => expect(ctx.push.sent).toHaveLength(2));
    expect(ctx.push.sent[1]!.body).toBe('private words');
  });

  it('removes a token the provider reports as DeviceNotRegistered', async () => {
    const a = await account();
    const dead = newToken();
    const alive = newToken();
    await register(a.token, dead);
    await register(a.token, alive);
    ctx.push.failures.set(dead, { status: 'error', error: 'DeviceNotRegistered' });
    await notifications.notify({ userId: a.id, category: 'system', title: 'x', body: 'b' });
    await vi.waitFor(async () => expect(await tokenCount(a.id)).toBe(1));
    const { rows } = await ctx.sql.query('SELECT token FROM push_tokens WHERE user_id = $1', [a.id]);
    expect(rows[0].token).toBe(alive);
  });

  it('ignores (and removes) tokens of a revoked session', async () => {
    const a = await account();
    const second = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: a.identifier, password: PASSWORD, device: { platform: 'ios', name: 'Second' } })
      .expect(200);
    const t1 = newToken();
    const t2 = newToken();
    await register(a.token, t1);
    await register(second.body.accessToken, t2);

    await ctx.http.delete(`/v1/auth/sessions/${second.body.sessionId}`).set(bearer(a.token)).expect(204);
    // Revocation also drops the token right away; simulate a path that does not (password reset style).
    await ctx.sql.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [a.tokens.sessionId]);
    await ctx.sql.query(
      `INSERT INTO push_tokens (user_id, session_id, token, platform) VALUES ($1, $2, $3, 'ios')`,
      [a.id, second.body.sessionId, t2],
    );
    const before = ctx.push.calls;
    await notifications.notify({ userId: a.id, category: 'system', title: 'x', body: 'b' });
    await pause();
    expect(ctx.push.calls).toBe(before);
    expect(await tokenCount(a.id)).toBe(0);
  });

  it('logout removes the session push tokens', async () => {
    const a = await account();
    await register(a.token, newToken());
    await ctx.http.post('/v1/auth/logout').set(bearer(a.token)).expect(204);
    expect(await tokenCount(a.id)).toBe(0);
  });

  it('never throws when the push provider fails, and groups notifyMany in one send', async () => {
    const a = await account();
    const b = await account();
    await register(a.token, newToken());
    await register(b.token, newToken());
    ctx.push.throwOnSend = new Error('provider down');
    await expect(
      notifications.notify({ userId: a.id, category: 'system', title: 'x', body: 'b' }),
    ).resolves.toBeUndefined();
    await pause();
    expect((await ctx.http.get('/v1/notifications/unread-count').set(bearer(a.token))).body.count).toBe(1);

    ctx.push.throwOnSend = null;
    const calls = ctx.push.calls;
    await notifications.notifyMany([
      { userId: a.id, category: 'system', title: 'm1', body: 'b' },
      { userId: b.id, category: 'system', title: 'm2', body: 'b' },
    ]);
    await vi.waitFor(() => expect(ctx.push.sent).toHaveLength(2));
    expect(ctx.push.calls).toBe(calls + 1);
  });
});

describe('security notification on login', () => {
  it('records a security notification with the device name', async () => {
    const a = await account();
    await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: a.identifier, password: PASSWORD, device: { platform: 'ios', name: 'Pixel de Test' } })
      .expect(200);
    await vi.waitFor(async () => {
      const list = await ctx.http.get('/v1/notifications').set(bearer(a.token)).expect(200);
      expect(list.body.items[0]).toMatchObject({ category: 'security', title: 'Nouvelle connexion', body: 'Pixel de Test' });
    });
  });
});
