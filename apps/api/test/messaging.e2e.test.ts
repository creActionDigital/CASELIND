import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { RealtimeService } from '../src/realtime/realtime.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

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
}

async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

/** Opens (or fetches) the direct conversation of `a` with `b`; returns its id. */
async function direct(a: TU, b: TU): Promise<string> {
  const res = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id });
  expect([200, 201]).toContain(res.status);
  return res.body.id;
}

async function group(owner: TU, members: TU[], title = 'Famille'): Promise<string> {
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

const messagesOf = (u: TU, convId: string, qs = '') =>
  ctx.http.get(`/v1/conversations/${convId}/messages${qs}`).set(bearer(u.token));

const privacy = (u: TU, patch: Record<string, unknown>) =>
  ctx.http.patch('/v1/me/privacy').set(bearer(u.token)).send(patch).expect(200);

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function uploadImage(u: TU, purpose: string): Promise<string> {
  const up = await ctx.http
    .post('/v1/media/uploads')
    .set(bearer(u.token))
    .send({ purpose, mime: 'image/png', sizeBytes: TINY_PNG.length })
    .expect(201);
  await ctx.http
    .put(up.body.uploadUrl)
    .set(bearer(u.token))
    .set('X-Upload-Token', up.body.uploadToken)
    .set('Content-Type', 'application/octet-stream')
    .send(TINY_PNG)
    .expect(200);
  return up.body.assetId;
}

describe('direct conversations', () => {
  it('is created once per pair, whoever asks, and is idempotent', async () => {
    const [a, b] = [await user(), await user()];
    const first = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id }).expect(201);
    expect(first.body).toMatchObject({ kind: 'direct', memberCount: 2, unreadCount: 0, lastMessage: null, peer: { userId: b.id } });
    const again = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id }).expect(200);
    expect(again.body.id).toBe(first.body.id);
    const reverse = await ctx.http.post('/v1/conversations').set(bearer(b.token)).send({ kind: 'direct', userId: a.id }).expect(200);
    expect(reverse.body.id).toBe(first.body.id);
    expect(reverse.body.peer.userId).toBe(a.id);
    const { rows } = await ctx.sql.query(`SELECT count(*)::int AS n FROM conversations WHERE kind = 'direct' AND direct_key LIKE $1`, [`%${a.id}%`]);
    expect(rows[0].n).toBe(1);
  });

  it('refuses yourself (400) and unknown or inactive users (404)', async () => {
    const [a, b] = [await user(), await user()];
    await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: a.id }).expect(400);
    await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: randomUUID() }).expect(404);
    await ctx.sql.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [b.id]);
    await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id }).expect(404);
  });

  it('answers 404 to non-members and to malformed ids, on every conversation route', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const id = await direct(a, b);
    await ctx.http.get(`/v1/conversations/${id}`).set(bearer(c.token)).expect(404);
    await messagesOf(c, id).expect(404);
    await send(c, id).expect(404);
    await ctx.http.post(`/v1/conversations/${id}/read`).set(bearer(c.token)).send({ seq: 1 }).expect(404);
    await ctx.http.get(`/v1/conversations/${id}/members`).set(bearer(c.token)).expect(404);
    await ctx.http.patch(`/v1/conversations/${id}/me`).set(bearer(c.token)).send({ pinned: true }).expect(404);
    await ctx.http.get('/v1/conversations/not-a-uuid').set(bearer(a.token)).expect(404);
    await send(a, 'not-a-uuid').expect(404);
    const msg = await send(a, id).expect(201);
    await ctx.http.put(`/v1/messages/${msg.body.id}/reaction`).set(bearer(c.token)).send({ emoji: '👍' }).expect(404);
    await ctx.http.delete(`/v1/messages/${msg.body.id}`).set(bearer(c.token)).expect(404);
  });
});

describe('blocking and contact requests', () => {
  it('blocks creation and sending in either direction, and hides the blocked user from group adds', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const id = await direct(a, b);
    await send(a, id).expect(201);
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await send(a, id).expect(403);
    await send(b, id).expect(403);
    const d = await user();
    await ctx.http.put(`/v1/blocks/${a.id}`).set(bearer(d.token)).expect(204);
    await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: d.id }).expect(403);
    await ctx.http.post('/v1/conversations').set(bearer(d.token)).send({ kind: 'direct', userId: a.id }).expect(403);
    const g = await group(a, [c]);
    const add = await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(a.token)).send({ userIds: [d.id] }).expect(404);
    const unknown = await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(a.token)).send({ userIds: [randomUUID()] }).expect(404);
    expect(add.body.message).toBe(unknown.body.message);
  });

  it('contactRequestsFrom=nobody: only existing contacts may start a conversation or add the user', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    await privacy(b, { contactRequestsFrom: 'nobody' });
    const denied = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id }).expect(403);
    expect(denied.body.error.code).toBe('forbidden');
    expect(denied.body.error.details).toMatchObject({ reason: 'contact_requests_restricted' });
    // b opens the conversation itself: a and b are now contacts.
    await ctx.http.post('/v1/conversations').set(bearer(b.token)).send({ kind: 'direct', userId: a.id }).expect(201);
    await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id }).expect(200);
    const g = await group(a, [c]);
    await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(a.token)).send({ userIds: [b.id] }).expect(201);
    const e = await user();
    await privacy(e, { contactRequestsFrom: 'nobody' });
    const g2 = await group(a, [c], 'Autre');
    const refused = await ctx.http.post(`/v1/conversations/${g2}/members`).set(bearer(a.token)).send({ userIds: [e.id] }).expect(403);
    expect(refused.body.error.details).toMatchObject({ reason: 'contact_requests_restricted' });
  });

  it('contactRequestsFrom=contacts_of_contacts: allowed with a common contact, refused without', async () => {
    const [a, mid, x, y] = [await user(), await user(), await user(), await user()];
    await direct(a, mid);
    await direct(x, mid);
    await privacy(x, { contactRequestsFrom: 'contacts_of_contacts' });
    await privacy(y, { contactRequestsFrom: 'contacts_of_contacts' });
    await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: x.id }).expect(201);
    const no = await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: y.id }).expect(403);
    expect(no.body.error.details).toMatchObject({ reason: 'contact_requests_restricted' });
  });

  it('contactRequestsFrom=everyone accepts anyone', async () => {
    const [a, b] = [await user(), await user()];
    await privacy(b, { contactRequestsFrom: 'everyone' });
    await ctx.http.post('/v1/conversations').set(bearer(a.token)).send({ kind: 'direct', userId: b.id }).expect(201);
  });
});

describe('sending messages', () => {
  it('is idempotent per clientId', async () => {
    const [a, b] = [await user(), await user()];
    const id = await direct(a, b);
    const clientId = randomUUID();
    const first = await send(a, id, { clientId }).expect(201);
    const retry = await send(a, id, { clientId, body: 'different retry body' }).expect(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.body).toBe('Bonjour');
    const list = await messagesOf(b, id).expect(200);
    expect(list.body.items).toHaveLength(1);
    // Another sender may reuse the same clientId.
    await send(b, id, { clientId }).expect(201);
  });

  it('numbers concurrent sends 1..10 without gaps', async () => {
    const [a, b] = [await user(), await user()];
    const id = await direct(a, b);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => send(i % 2 === 0 ? a : b, id, { body: `m${i}` })),
    );
    for (const r of results) expect(r.status).toBe(201);
    const seqs = results.map((r) => r.body.seq as number).sort((x, y) => x - y);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const list = await messagesOf(a, id).expect(200);
    expect(list.body.items.map((m: { seq: number }) => m.seq)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('validates bodies, mentions and replies', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const id = await direct(a, b);
    await send(a, id, { body: '' }).expect(400);
    await send(a, id, { body: 'x'.repeat(4001) }).expect(400);
    await send(a, id, { body: 'x'.repeat(4000) }).expect(201);
    await send(a, id, { mentions: [c.id] }).expect(400);
    await send(a, id, { mentions: [b.id] }).expect(201);
    await send(a, id, { mentions: Array.from({ length: 51 }, () => randomUUID()) }).expect(400);
    const first = await send(a, id).expect(201);
    const reply = await send(b, id, { replyToId: first.body.id }).expect(201);
    expect(reply.body.replyToId).toBe(first.body.id);
    await send(b, id, { replyToId: randomUUID() }).expect(400);
    const other = await direct(a, c);
    await send(a, other, { replyToId: first.body.id }).expect(400);
  });

  it('paginates with beforeSeq and limit', async () => {
    const [a, b] = [await user(), await user()];
    const id = await direct(a, b);
    for (let i = 0; i < 5; i++) await send(a, id, { body: `m${i}` }).expect(201);
    const page1 = await messagesOf(b, id, '?limit=2').expect(200);
    expect(page1.body.items.map((m: { seq: number }) => m.seq)).toEqual([5, 4]);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await messagesOf(b, id, '?limit=2&beforeSeq=4').expect(200);
    expect(page2.body.items.map((m: { seq: number }) => m.seq)).toEqual([3, 2]);
    const page3 = await messagesOf(b, id, '?limit=2&beforeSeq=2').expect(200);
    expect(page3.body).toMatchObject({ hasMore: false });
    await messagesOf(b, id, '?limit=101').expect(400);
  });

  it('lets a member react once per message and change or remove the reaction', async () => {
    const [a, b] = [await user(), await user()];
    const id = await direct(a, b);
    const m = await send(a, id).expect(201);
    const r1 = await ctx.http.put(`/v1/messages/${m.body.id}/reaction`).set(bearer(b.token)).send({ emoji: '👍' }).expect(200);
    expect(r1.body.reactions).toEqual([{ emoji: '👍', count: 1 }]);
    expect(r1.body.myReaction).toBe('👍');
    const r2 = await ctx.http.put(`/v1/messages/${m.body.id}/reaction`).set(bearer(b.token)).send({ emoji: '❤️' }).expect(200);
    expect(r2.body.reactions).toEqual([{ emoji: '❤️', count: 1 }]);
    await ctx.http.put(`/v1/messages/${m.body.id}/reaction`).set(bearer(a.token)).send({ emoji: '❤️' }).expect(200);
    const list = await messagesOf(a, id).expect(200);
    expect(list.body.items[0].reactions).toEqual([{ emoji: '❤️', count: 2 }]);
    await ctx.http.put(`/v1/messages/${m.body.id}/reaction`).set(bearer(b.token)).send({ emoji: null }).expect(200);
    await ctx.http.put(`/v1/messages/${m.body.id}/reaction`).set(bearer(b.token)).send({ emoji: 'x'.repeat(17) }).expect(400);
  });
});

describe('media messages', () => {
  it('accepts only own, ready uploads with purpose message; members read them, others do not, nobody after recall', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const id = await direct(a, b);
    const foreign = await uploadImage(b, 'message');
    await send(a, id, { kind: 'media', body: undefined, mediaId: foreign }).expect(400);
    const wrongPurpose = await uploadImage(a, 'avatar');
    await send(a, id, { kind: 'media', body: undefined, mediaId: wrongPurpose }).expect(400);
    await send(a, id, { kind: 'media', body: undefined, mediaId: randomUUID() }).expect(400);

    const asset = await uploadImage(a, 'message');
    // Not yet sent: only the owner reads it.
    await ctx.http.get(`/v1/media/${asset}/content`).set(bearer(b.token)).expect(404);
    const msg = await send(a, id, { kind: 'media', body: 'la photo', mediaId: asset }).expect(201);
    expect(msg.body.media).toMatchObject({ id: asset, mime: 'image/png', contentUrl: `/v1/media/${asset}/content` });
    expect(msg.body.body).toBe('la photo');
    await ctx.http.get(`/v1/media/${asset}/content`).set(bearer(b.token)).expect(200);
    await ctx.http.get(`/v1/media/${asset}`).set(bearer(b.token)).expect(200);
    await ctx.http.get(`/v1/media/${asset}/content`).set(bearer(c.token)).expect(404);

    await ctx.http.delete(`/v1/messages/${msg.body.id}?scope=all`).set(bearer(a.token)).expect(204);
    await ctx.http.get(`/v1/media/${asset}/content`).set(bearer(b.token)).expect(404);
    await ctx.http.get(`/v1/media/${asset}/content`).set(bearer(a.token)).expect(200);
  });
});

describe('recalling and hiding messages', () => {
  it('recalls within the window, refuses others and late recalls, and hides for me only', async () => {
    const [a, b] = [await user(), await user()];
    const id = await direct(a, b);
    const m = await send(a, id, { body: 'secret' }).expect(201);
    await ctx.http.delete(`/v1/messages/${m.body.id}?scope=all`).set(bearer(b.token)).expect(403);
    await ctx.http.delete(`/v1/messages/${m.body.id}?scope=all`).set(bearer(a.token)).expect(204);
    // Idempotent.
    await ctx.http.delete(`/v1/messages/${m.body.id}?scope=all`).set(bearer(a.token)).expect(204);
    const list = await messagesOf(b, id).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: m.body.id, recalled: true, body: null, media: null });
    const { rows } = await ctx.sql.query(`SELECT body, recalled_at FROM messages WHERE id = $1`, [m.body.id]);
    expect(rows[0].body).toBeNull();
    expect(rows[0].recalled_at).not.toBeNull();
    await ctx.http.put(`/v1/messages/${m.body.id}/reaction`).set(bearer(b.token)).send({ emoji: '👍' }).expect(409);

    const late = await send(a, id, { body: 'trop tard' }).expect(201);
    await ctx.sql.query(`UPDATE messages SET created_at = now() - interval '10 minutes' WHERE id = $1`, [late.body.id]);
    const res = await ctx.http.delete(`/v1/messages/${late.body.id}?scope=all`).set(bearer(a.token)).expect(409);
    expect(res.body.error.details).toMatchObject({ reason: 'recall_window_elapsed' });

    // scope=me (default) hides for the caller only, with no time limit.
    await ctx.http.delete(`/v1/messages/${late.body.id}`).set(bearer(b.token)).expect(204);
    expect((await messagesOf(b, id).expect(200)).body.items.map((x: { id: string }) => x.id)).not.toContain(late.body.id);
    expect((await messagesOf(a, id).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(late.body.id);
    const audits = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'message.recalled' AND actor_user_id = $1`, [a.id]);
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows[0].metadata)).not.toContain('secret');
  });
});

describe('receipts, unread counters and the list', () => {
  it('tracks unread messages and keeps positions monotone and bounded', async () => {
    const [a, b] = [await user(), await user()];
    const id = await direct(a, b);
    for (let i = 0; i < 3; i++) await send(a, id, { body: `m${i}` }).expect(201);
    const before = await ctx.http.get(`/v1/conversations/${id}`).set(bearer(b.token)).expect(200);
    expect(before.body).toMatchObject({ unreadCount: 3, lastSeq: 3, lastMessage: { seq: 3 } });
    const d = await ctx.http.post(`/v1/conversations/${id}/delivered`).set(bearer(b.token)).send({ seq: 2 }).expect(200);
    expect(d.body).toMatchObject({ lastDeliveredSeq: 2, lastReadSeq: 0, unreadCount: 3 });
    const r1 = await ctx.http.post(`/v1/conversations/${id}/read`).set(bearer(b.token)).send({ seq: 2 }).expect(200);
    expect(r1.body).toMatchObject({ lastDeliveredSeq: 2, lastReadSeq: 2, unreadCount: 1 });
    const back = await ctx.http.post(`/v1/conversations/${id}/read`).set(bearer(b.token)).send({ seq: 1 }).expect(200);
    expect(back.body).toMatchObject({ lastReadSeq: 2, unreadCount: 1 });
    const over = await ctx.http.post(`/v1/conversations/${id}/read`).set(bearer(b.token)).send({ seq: 99 }).expect(200);
    expect(over.body).toMatchObject({ lastDeliveredSeq: 3, lastReadSeq: 3, unreadCount: 0 });
    // The author never has unread messages from their own sends.
    expect((await ctx.http.get(`/v1/conversations/${id}`).set(bearer(a.token)).expect(200)).body.unreadCount).toBe(0);
  });

  it('keeps counting unread but hides the position when readReceipts is off', async () => {
    const [a, b] = [await user(), await user()];
    await privacy(b, { readReceipts: false });
    const id = await direct(a, b);
    await send(a, id).expect(201);
    const rt = ctx.app.get(RealtimeService);
    const spy = vi.spyOn(rt, 'emitToConversation');
    const res = await ctx.http.post(`/v1/conversations/${id}/read`).set(bearer(b.token)).send({ seq: 1 }).expect(200);
    expect(res.body).toMatchObject({ lastReadSeq: 1, unreadCount: 0 });
    await vi.waitFor(() => expect(spy.mock.calls.some((c) => c[1] === 'receipt.updated')).toBe(true));
    const event = spy.mock.calls.find((c) => c[1] === 'receipt.updated')![2] as { userId: string; lastReadSeq: number | null; lastDeliveredSeq: number };
    expect(event).toMatchObject({ userId: b.id, lastDeliveredSeq: 1, lastReadSeq: null });
    spy.mockRestore();
    const members = await ctx.http.get(`/v1/conversations/${id}/members`).set(bearer(a.token)).expect(200);
    expect(members.body.items.find((m: { userId: string }) => m.userId === b.id).lastReadSeq).toBeNull();
    const own = await ctx.http.get(`/v1/conversations/${id}/members`).set(bearer(b.token)).expect(200);
    expect(own.body.items.find((m: { userId: string }) => m.userId === b.id).lastReadSeq).toBe(1);
  });

  it('lists pinned first, filters archived, unarchives on new messages and paginates by cursor', async () => {
    const [a, b, c, d] = [await user(), await user(), await user(), await user()];
    const c1 = await direct(a, b);
    const c2 = await direct(a, c);
    const c3 = await direct(a, d);
    await send(b, c1).expect(201);
    await send(c, c2).expect(201);
    await send(d, c3).expect(201);
    let list = await ctx.http.get('/v1/conversations').set(bearer(a.token)).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([c3, c2, c1]);
    await ctx.http.patch(`/v1/conversations/${c1}/me`).set(bearer(a.token)).send({ pinned: true }).expect(200);
    await ctx.http.patch(`/v1/conversations/${c2}/me`).set(bearer(a.token)).send({ archived: true }).expect(200);
    list = await ctx.http.get('/v1/conversations').set(bearer(a.token)).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([c1, c3]);
    expect(list.body.items[0]).toMatchObject({ pinned: true, unreadCount: 1, peer: { userId: b.id } });
    const archived = await ctx.http.get('/v1/conversations?archived=true').set(bearer(a.token)).expect(200);
    expect(archived.body.items.map((i: { id: string }) => i.id)).toEqual([c2]);
    // Pagination: pinned first, then by activity.
    const p1 = await ctx.http.get('/v1/conversations?limit=1').set(bearer(a.token)).expect(200);
    expect(p1.body.items[0].id).toBe(c1);
    const p2 = await ctx.http.get(`/v1/conversations?limit=1&cursor=${p1.body.nextCursor}`).set(bearer(a.token)).expect(200);
    expect(p2.body.items[0].id).toBe(c3);
    expect(p2.body.nextCursor).toBeNull();
    await ctx.http.get('/v1/conversations?cursor=garbage').set(bearer(a.token)).expect(400);
    // A new message brings an archived conversation back.
    await send(c, c2).expect(201);
    expect((await ctx.http.get('/v1/conversations?archived=true').set(bearer(a.token)).expect(200)).body.items).toHaveLength(0);
    const mute = new Date(Date.now() + 3_600_000).toISOString();
    const me = await ctx.http.patch(`/v1/conversations/${c1}/me`).set(bearer(a.token)).send({ mutedUntil: mute }).expect(200);
    expect(me.body.mutedUntil).toBe(mute);
    await ctx.http.patch(`/v1/conversations/${c1}/me`).set(bearer(a.token)).send({}).expect(400);
  });

  it('hides a direct conversation from the peer until its first message', async () => {
    const [a, b] = [await user(), await user()];
    const id = await direct(a, b);
    expect((await ctx.http.get('/v1/conversations').set(bearer(b.token)).expect(200)).body.items).toHaveLength(0);
    expect((await ctx.http.get('/v1/conversations').set(bearer(a.token)).expect(200)).body.items).toHaveLength(1);
    await send(a, id).expect(201);
    expect((await ctx.http.get('/v1/conversations').set(bearer(b.token)).expect(200)).body.items).toHaveLength(1);
  });
});

describe('groups', () => {
  it('enforces roles on members, titles and the last owner', async () => {
    const [o, m1, m2, m3] = [await user(), await user(), await user(), await user()];
    const g = await group(o, [m1, m2], 'Équipe');
    const members = await ctx.http.get(`/v1/conversations/${g}/members`).set(bearer(m1.token)).expect(200);
    expect(members.body.items.map((x: { role: string }) => x.role).sort()).toEqual(['member', 'member', 'owner']);

    // Plain members cannot add, edit or remove.
    await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(m1.token)).send({ userIds: [m3.id] }).expect(403);
    await ctx.http.patch(`/v1/conversations/${g}`).set(bearer(m1.token)).send({ title: 'Nope' }).expect(403);
    await ctx.http.delete(`/v1/conversations/${g}/members/${m2.id}`).set(bearer(m1.token)).expect(403);
    await ctx.http.patch(`/v1/conversations/${g}/members/${m1.id}`).set(bearer(m1.token)).send({ role: 'owner' }).expect(403);

    // Only the owner changes roles; an admin may add and edit, but cannot remove the owner.
    await ctx.http.patch(`/v1/conversations/${g}/members/${m1.id}`).set(bearer(o.token)).send({ role: 'admin' }).expect(200);
    await ctx.http.patch(`/v1/conversations/${g}/members/${m2.id}`).set(bearer(m1.token)).send({ role: 'admin' }).expect(403);
    await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(m1.token)).send({ userIds: [m3.id] }).expect(201);
    const edited = await ctx.http
      .patch(`/v1/conversations/${g}`)
      .set(bearer(m1.token))
      .send({ title: 'Équipe 2', announcement: 'Réunion lundi' })
      .expect(200);
    expect(edited.body).toMatchObject({ title: 'Équipe 2', announcement: 'Réunion lundi' });
    await ctx.http.delete(`/v1/conversations/${g}/members/${o.id}`).set(bearer(m1.token)).expect(403);
    await ctx.http.delete(`/v1/conversations/${g}/members/${m3.id}`).set(bearer(m1.token)).expect(204);
    await ctx.http.get(`/v1/conversations/${g}`).set(bearer(m3.token)).expect(404);

    // The only owner cannot be demoted.
    const demote = await ctx.http.patch(`/v1/conversations/${g}/members/${o.id}`).set(bearer(o.token)).send({ role: 'member' }).expect(409);
    expect(demote.body.error.details).toMatchObject({ reason: 'last_owner' });

    // System messages describe what happened.
    const log = await messagesOf(o, g).expect(200);
    const types = log.body.items.filter((i: { kind: string }) => i.kind === 'system').map((i: { systemEvent: { type: string } }) => i.systemEvent.type);
    expect(types).toEqual(expect.arrayContaining(['group_created', 'title_changed', 'member_added', 'member_removed']));

    // Governance is audited, content is not.
    const { rows } = await ctx.sql.query(`SELECT action FROM audit_events WHERE actor_user_id = ANY($1::uuid[]) AND action LIKE 'conversation.%'`, [[o.id, m1.id]]);
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['conversation.group_created', 'conversation.member_added', 'conversation.member_role_changed', 'conversation.member_removed']));
  });

  it('hands ownership over when the last owner leaves, and survives an empty group', async () => {
    const [o, adm, mem] = [await user(), await user(), await user()];
    const g = await group(o, [mem, adm]);
    await ctx.http.patch(`/v1/conversations/${g}/members/${adm.id}`).set(bearer(o.token)).send({ role: 'admin' }).expect(200);
    await ctx.http.delete(`/v1/conversations/${g}/members/${o.id}`).set(bearer(o.token)).expect(204);
    await ctx.http.get(`/v1/conversations/${g}`).set(bearer(o.token)).expect(404);
    let members = await ctx.http.get(`/v1/conversations/${g}/members`).set(bearer(mem.token)).expect(200);
    expect(members.body.items.find((x: { userId: string }) => x.userId === adm.id).role).toBe('owner');
    expect(members.body.items.find((x: { userId: string }) => x.userId === mem.id).role).toBe('member');
    await ctx.http.delete(`/v1/conversations/${g}/members/${adm.id}`).set(bearer(adm.token)).expect(204);
    members = await ctx.http.get(`/v1/conversations/${g}/members`).set(bearer(mem.token)).expect(200);
    expect(members.body.items.find((x: { userId: string }) => x.userId === mem.id).role).toBe('owner');
    await ctx.http.delete(`/v1/conversations/${g}/members/${mem.id}`).set(bearer(mem.token)).expect(204);
    const { rows } = await ctx.sql.query(`SELECT count(*)::int AS n FROM conversation_members WHERE conversation_id = $1 AND status = 'active'`, [g]);
    expect(rows[0].n).toBe(0);
    // Direct conversations cannot be left.
    const dm = await direct(o, mem);
    await ctx.http.delete(`/v1/conversations/${dm}/members/${o.id}`).set(bearer(o.token)).expect(403);
  });

  it('shows no history to a member who joined late, and returning members start afresh', async () => {
    const [o, early, late] = [await user(), await user(), await user()];
    const g = await group(o, [early]);
    await send(o, g, { body: 'avant' }).expect(201);
    await send(early, g, { body: 'avant 2' }).expect(201);
    await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(o.token)).send({ userIds: [late.id, late.id] }).expect(201);
    await send(o, g, { body: 'après' }).expect(201);
    const seen = await messagesOf(late, g).expect(200);
    const bodies = seen.body.items.filter((i: { kind: string }) => i.kind !== 'system').map((i: { body: string }) => i.body);
    expect(bodies).toEqual(['après']);
    const full = await messagesOf(early, g).expect(200);
    expect(full.body.items.filter((i: { kind: string }) => i.kind !== 'system')).toHaveLength(3);
    const conv = await ctx.http.get(`/v1/conversations/${g}`).set(bearer(late.token)).expect(200);
    expect(conv.body.unreadCount).toBe(1);
    // Adding a current member again does nothing.
    const again = await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(o.token)).send({ userIds: [late.id] }).expect(201);
    expect(again.body.items).toHaveLength(0);
    // Messages sent while someone was away stay invisible after they come back.
    await ctx.http.delete(`/v1/conversations/${g}/members/${late.id}`).set(bearer(late.token)).expect(204);
    await send(o, g, { body: 'pendant' }).expect(201);
    await ctx.http.post(`/v1/conversations/${g}/members`).set(bearer(o.token)).send({ userIds: [late.id] }).expect(201);
    const back = await messagesOf(late, g).expect(200);
    expect(back.body.items.filter((i: { kind: string }) => i.kind !== 'system').map((i: { body: string }) => i.body)).toEqual([]);
  });

  it('caps the group size', async () => {
    const small = await createTestContext({ MESSAGING_GROUP_MAX_MEMBERS: '3' });
    try {
      const mk = async (): Promise<TU> => {
        const { tokens } = await signUp(small);
        const me = await small.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
        return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
      };
      const [o, a, b, c] = [await mk(), await mk(), await mk(), await mk()];
      await small.http.post('/v1/conversations').set(bearer(o.token)).send({ kind: 'group', title: 'Trop', memberIds: [a.id, b.id, c.id] }).expect(409);
      const g = await small.http.post('/v1/conversations').set(bearer(o.token)).send({ kind: 'group', title: 'Ok', memberIds: [a.id, b.id] }).expect(201);
      const full = await small.http.post(`/v1/conversations/${g.body.id}/members`).set(bearer(o.token)).send({ userIds: [c.id] }).expect(409);
      expect(full.body.error.details).toMatchObject({ reason: 'group_full', max: 3 });
    } finally {
      await small.close();
    }
  });

  it('accepts only an own avatar upload for a group', async () => {
    const [o, m] = [await user(), await user()];
    const avatar = await uploadImage(o, 'avatar');
    const bad = await uploadImage(o, 'message');
    await ctx.http.post('/v1/conversations').set(bearer(o.token)).send({ kind: 'group', title: 'X', avatarAssetId: bad }).expect(400);
    const g = await ctx.http
      .post('/v1/conversations')
      .set(bearer(o.token))
      .send({ kind: 'group', title: 'X', memberIds: [m.id], avatarAssetId: avatar })
      .expect(201);
    expect(g.body.avatarUrl).toBe(`/v1/media/${avatar}/content`);
    await ctx.http.patch(`/v1/conversations/${g.body.id}`).set(bearer(o.token)).send({ avatarAssetId: null }).expect(200);
  });
});

describe('push notifications', () => {
  it('sends a generic body to unmuted members, none to muted ones unless mentioned, never the content', async () => {
    const [s, r1, r2, r3] = [await user(), await user(), await user(), await user()];
    const g = await group(s, [r1, r2, r3], 'Les amis');
    const mute = new Date(Date.now() + 3_600_000).toISOString();
    await ctx.http.patch(`/v1/conversations/${g}/me`).set(bearer(r2.token)).send({ mutedUntil: mute }).expect(200);
    await ctx.http.patch(`/v1/conversations/${g}/me`).set(bearer(r3.token)).send({ mutedUntil: mute }).expect(200);
    const notifications = ctx.app.get(NotificationsService);
    const spy = vi.spyOn(notifications, 'notifyMany').mockResolvedValue();
    const msg = await send(s, g, { body: 'contenu très privé', mentions: [r3.id] }).expect(201);
    expect(spy).toHaveBeenCalledTimes(1);
    const inputs = spy.mock.calls[0]![0];
    expect(inputs.map((i) => i.userId).sort()).toEqual([r1.id, r3.id].sort());
    for (const i of inputs) {
      expect(i).toMatchObject({
        category: 'message',
        title: 'Les amis',
        persist: false,
        data: { conversationId: g, messageId: msg.body.id },
      });
      expect(i.body).toBe(i.userId === r3.id ? 'Vous avez été mentionné(e)' : 'Nouveau message');
      expect(JSON.stringify(i)).not.toContain('privé');
    }
    // A mention reaches a muted conversation but does not bypass quiet mode.
    expect(inputs.find((i) => i.userId === r3.id)?.genericBody).toBe(true);
    expect(inputs.every((i) => i.urgent === undefined)).toBe(true);
    spy.mockClear();
    const dm = await direct(r1, s);
    await send(r1, dm).expect(201);
    const dmInputs = spy.mock.calls[0]![0];
    expect(dmInputs).toHaveLength(1);
    expect(dmInputs[0]).toMatchObject({ userId: s.id, title: 'Test User', body: 'Nouveau message' });
    spy.mockRestore();
  });
});

describe('account data', () => {
  it('exports conversations and sent messages, then erases bodies and memberships on purge', async () => {
    const [a, b] = [await user(), await user()];
    const dm = await direct(a, b);
    const kept = await send(a, dm, { body: 'à exporter' }).expect(201);
    const recalled = await send(a, dm, { body: 'rappelé' }).expect(201);
    await ctx.http.delete(`/v1/messages/${recalled.body.id}?scope=all`).set(bearer(a.token)).expect(204);
    const g = await group(a, [b]);
    await send(b, dm, { body: 'réponse de b' }).expect(201);

    const exp = await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200);
    expect(exp.body.conversations.map((c: { id: string }) => c.id).sort()).toEqual([dm, g].sort());
    expect(exp.body.conversations.find((c: { id: string }) => c.id === g)).toMatchObject({ kind: 'group', role: 'owner' });
    expect(exp.body.messagesSent.map((m: { id: string }) => m.id)).toEqual([kept.body.id]);
    expect(exp.body.messagesSent[0]).toMatchObject({ conversationId: dm, kind: 'text', body: 'à exporter' });

    await ctx.http.post('/v1/me/deletion-request').set(bearer(a.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [a.id]);
    const run = await ctx.app.get(MaintenanceService).runOnce();
    expect(run.deletedAccounts).toBeGreaterThanOrEqual(1);

    const members = await ctx.sql.query(`SELECT conversation_id, status FROM conversation_members WHERE user_id = $1`, [a.id]);
    expect(members.rows.every((r) => r.status === 'left')).toBe(true);
    const msgs = await ctx.sql.query(`SELECT body, media_id FROM messages WHERE sender_id = $1 AND kind <> 'system'`, [a.id]);
    expect(msgs.rows.length).toBeGreaterThan(0);
    expect(msgs.rows.every((r) => r.body === null && r.media_id === null)).toBe(true);
    // The group the deleted owner left still has an owner; the other participant keeps their own words.
    const owners = await ctx.sql.query(`SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND status = 'active' AND role = 'owner'`, [g]);
    expect(owners.rows.map((r) => r.user_id)).toEqual([b.id]);
    const list = await messagesOf(b, dm).expect(200);
    expect(list.body.items.find((m: { id: string }) => m.id === kept.body.id).body).toBeNull();
    expect(list.body.items.some((m: { body: string | null }) => m.body === 'réponse de b')).toBe(true);
    // The remaining participant cannot write into a direct conversation whose peer is gone.
    await send(b, dm).expect(403);
  });
});

describe('document messages', () => {
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n');
  const put = async (u: TU, mime: string, content: Buffer, fileName?: string) => {
    const up = await ctx.http.post('/v1/media/uploads').set(bearer(u.token)).send({ purpose: 'message', mime, sizeBytes: content.length, fileName }).expect(201);
    const r = await ctx.http.put(up.body.uploadUrl).set(bearer(u.token)).set('X-Upload-Token', up.body.uploadToken).set('Content-Type', 'application/octet-stream').send(content);
    return { id: up.body.assetId as string, status: r.status };
  };
  it('sends a PDF with a cleaned name: members read it, others do not; executables are refused', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const id = await direct(a, b);
    const doc = await put(a, 'application/pdf', PDF, '..\evil/"rapport".pdf');
    expect(doc.status).toBe(200);
    const msg = await send(a, id, { kind: 'media', body: undefined, mediaId: doc.id }).expect(201);
    expect(msg.body.media).toMatchObject({ id: doc.id, mime: 'application/pdf', fileName: 'rapport.pdf' });
    const dl = await ctx.http.get(`/v1/media/${doc.id}/content`).set(bearer(b.token)).expect(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    await ctx.http.get(`/v1/media/${doc.id}/content`).set(bearer(c.token)).expect(404);
    await ctx.http.post('/v1/media/uploads').set(bearer(a.token)).send({ purpose: 'message', mime: 'application/x-msdownload', sizeBytes: 10 }).expect(400);
    const exe = await put(a, 'application/pdf', Buffer.from('MZ\x90\x00\x03 executable'));
    expect(exe.status).toBeGreaterThanOrEqual(400);
    await send(a, id, { kind: 'media', body: undefined, mediaId: exe.id }).expect(400);
  });
});

describe('voice messages', () => {
  const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x88, 0x42, 0x82, 0x84]), Buffer.from('webm'), Buffer.alloc(64)]);
  const put = async (u: TU, mime: string, content: Buffer, durationSec?: number) => {
    const up = await ctx.http.post('/v1/media/uploads').set(bearer(u.token)).send({ purpose: 'message', mime, sizeBytes: content.length, durationSec }).expect(201);
    const r = await ctx.http.put(up.body.uploadUrl).set(bearer(u.token)).set('X-Upload-Token', up.body.uploadToken).set('Content-Type', 'application/octet-stream').send(content);
    return { id: up.body.assetId as string, status: r.status };
  };
  it('sends a voice note with its duration: members read it, others do not; fake audio and bad durations are refused', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const id = await direct(a, b);
    const voice = await put(a, 'audio/webm', WEBM, 42);
    expect(voice.status).toBe(200);
    const msg = await send(a, id, { kind: 'media', body: undefined, mediaId: voice.id }).expect(201);
    expect(msg.body.media).toMatchObject({ id: voice.id, mime: 'audio/webm', durationSec: 42 });
    const list = await messagesOf(b, id).expect(200);
    expect(list.body.items.find((m: { id: string }) => m.id === msg.body.id).media.durationSec).toBe(42);
    await ctx.http.get(`/v1/media/${voice.id}/content`).set(bearer(b.token)).expect(200);
    await ctx.http.get(`/v1/media/${voice.id}/content`).set(bearer(c.token)).expect(404);
    const fake = await put(a, 'audio/mpeg', Buffer.from('MZ  not audio'), 5);
    expect(fake.status).toBeGreaterThanOrEqual(400);
    await send(a, id, { kind: 'media', body: undefined, mediaId: fake.id }).expect(400);
    for (const durationSec of [0, 301]) await ctx.http.post('/v1/media/uploads').set(bearer(a.token)).send({ purpose: 'message', mime: 'audio/webm', sizeBytes: 100, durationSec }).expect(400);
    await ctx.http.post('/v1/media/uploads').set(bearer(a.token)).send({ purpose: 'message', mime: 'application/pdf', sizeBytes: 100, durationSec: 5 }).expect(400);
  });
});
