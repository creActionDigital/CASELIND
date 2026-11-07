import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { ScheduledMessagesService } from '../src/messaging/scheduled-messages.service.js';
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
}

async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id };
}

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

const messagesOf = (u: TU, convId: string) => ctx.http.get(`/v1/conversations/${convId}/messages`).set(bearer(u.token));

const forward = (u: TU, messageId: string, conversationIds: string[], clientId = randomUUID()) =>
  ctx.http.post(`/v1/messages/${messageId}/forward`).set(bearer(u.token)).send({ conversationIds, clientId });

const favorites = (u: TU) => ctx.http.get('/v1/me/favorites').set(bearer(u.token));

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function uploadMessageImage(u: TU): Promise<string> {
  const up = await ctx.http
    .post('/v1/media/uploads')
    .set(bearer(u.token))
    .send({ purpose: 'message', mime: 'image/png', sizeBytes: TINY_PNG.length })
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

describe('forwarding', () => {
  it('forwards to several conversations, reporting each one without leaking why a refusal happened', async () => {
    const [a, b, c, outsider] = [await user(), await user(), await user(), await user()];
    const dm = await direct(a, b);
    const g = await group(a, [b, c]);
    const other = await direct(outsider, c);
    const src = await send(b, dm, { body: 'à transférer' }).expect(201);

    const res = await forward(a, src.body.id, [g, other, randomUUID()]).expect(200);
    const [okG, notMember, unknown] = res.body.results;
    expect(okG).toMatchObject({ conversationId: g, status: 'sent', code: null });
    expect(okG.message).toMatchObject({ body: 'à transférer', forwarded: true, senderId: a.id, replyToId: null });
    // Unknown and foreign conversations are indistinguishable.
    expect(notMember).toMatchObject({ status: 'error', code: 'not_found', message: null });
    expect(unknown).toMatchObject({ status: 'error', code: 'not_found', message: null });
    // Nothing in the copy points back to the original author or message.
    expect(JSON.stringify(okG.message)).not.toContain(b.id);
    expect(JSON.stringify(okG.message)).not.toContain(src.body.id);

    const list = await messagesOf(c, g).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: okG.message.id, forwarded: true });

    // Idempotent per clientId.
    const cid = randomUUID();
    const first = await forward(a, src.body.id, [g], cid).expect(200);
    const again = await forward(a, src.body.id, [g], cid).expect(200);
    expect(again.body.results[0].message.id).toBe(first.body.results[0].message.id);
    expect((await messagesOf(c, g)).body.items.filter((m: { forwarded: boolean }) => m.forwarded)).toHaveLength(2);
  });

  it('applies the send rules per destination and refuses unreadable, recalled and system messages', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const dmAB = await direct(a, b);
    const dmAC = await direct(a, c);
    const src = await send(a, dmAB).expect(201);
    await ctx.http.put(`/v1/blocks/${c.id}`).set(bearer(a.token)).expect(204);
    const res = await forward(a, src.body.id, [dmAB, dmAC]).expect(200);
    expect(res.body.results[0].status).toBe('sent');
    expect(res.body.results[1]).toMatchObject({ status: 'error', code: 'not_allowed', message: null });

    // A stranger cannot read the source.
    await forward(c, src.body.id, [dmAC]).expect(404);
    await forward(a, 'not-a-uuid', [dmAB]).expect(404);
    // Recalled.
    const recalled = await send(a, dmAB).expect(201);
    await ctx.http.delete(`/v1/messages/${recalled.body.id}?scope=all`).set(bearer(a.token)).expect(204);
    await forward(a, recalled.body.id, [dmAB]).expect(409);
    // System message.
    const g = await group(a, [b]);
    const sys = (await messagesOf(a, g).expect(200)).body.items.find((m: { kind: string }) => m.kind === 'system');
    await forward(a, sys.id, [dmAB]).expect(400);
    // Validation: 1 to 10 destinations.
    await forward(a, src.body.id, []).expect(400);
    await forward(a, src.body.id, Array.from({ length: 11 }, () => randomUUID())).expect(400);
  });

  it('keeps a forwarded media readable for the members of the destination only', async () => {
    const [a, b, c, outsider] = [await user(), await user(), await user(), await user()];
    const dm = await direct(a, b);
    const g = await group(b, [c]);
    const mediaId = await uploadMessageImage(a);
    const src = await send(a, dm, { kind: 'media', mediaId, body: undefined }).expect(201);
    const url = src.body.media.contentUrl as string;
    await ctx.http.get(url).set(bearer(c.token)).expect(404);

    const res = await forward(b, src.body.id, [g]).expect(200);
    expect(res.body.results[0].message.media.id).toBe(mediaId);
    await ctx.http.get(url).set(bearer(c.token)).expect(200);
    await ctx.http.get(url).set(bearer(outsider.token)).expect(404);

    // The original is recalled: the forwarded copy keeps its own access.
    await ctx.http.delete(`/v1/messages/${src.body.id}?scope=all`).set(bearer(a.token)).expect(204);
    await ctx.http.get(url).set(bearer(c.token)).expect(200);
  });
});

describe('favourites', () => {
  it('lists newest first with a cursor and is idempotent', async () => {
    const [a, b] = [await user(), await user()];
    const dm = await direct(a, b);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await send(b, dm, { body: `m${i}` }).expect(201)).body.id);
    for (const id of ids) {
      await ctx.http.put(`/v1/messages/${id}/favorite`).set(bearer(a.token)).expect(204);
      await ctx.http.put(`/v1/messages/${id}/favorite`).set(bearer(a.token)).expect(204);
    }
    const page1 = await ctx.http.get('/v1/me/favorites?limit=2').set(bearer(a.token)).expect(200);
    expect(page1.body.items.map((i: { message: { id: string } }) => i.message.id)).toEqual([ids[2], ids[1]]);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await ctx.http.get(`/v1/me/favorites?limit=2&cursor=${page1.body.nextCursor}`).set(bearer(a.token)).expect(200);
    expect(page2.body.items.map((i: { message: { id: string } }) => i.message.id)).toEqual([ids[0]]);
    expect(page2.body.nextCursor).toBeNull();

    await ctx.http.delete(`/v1/messages/${ids[0]}/favorite`).set(bearer(a.token)).expect(204);
    await ctx.http.delete(`/v1/messages/${ids[0]}/favorite`).set(bearer(a.token)).expect(204);
    expect((await favorites(a).expect(200)).body.items).toHaveLength(2);
    // Invisible, malformed or foreign ids.
    const stranger = await user();
    await ctx.http.put(`/v1/messages/${ids[1]}/favorite`).set(bearer(stranger.token)).expect(404);
    await ctx.http.put('/v1/messages/nope/favorite').set(bearer(a.token)).expect(404);
  });

  it('masks a favourite once access is lost (left, recalled, blocked) and brings it back with access', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const g = await group(a, [b, c]);
    const fromB = await send(b, g, { body: 'de b' }).expect(201);
    const fromC = await send(c, g, { body: 'de c' }).expect(201);
    const toRecall = await send(c, g, { body: 'à rappeler' }).expect(201);
    for (const m of [fromB, fromC, toRecall]) await ctx.http.put(`/v1/messages/${m.body.id}/favorite`).set(bearer(a.token)).expect(204);
    const count = async () => (await favorites(a).expect(200)).body.items.length as number;
    expect(await count()).toBe(3);

    await ctx.http.delete(`/v1/messages/${toRecall.body.id}?scope=all`).set(bearer(c.token)).expect(204);
    expect(await count()).toBe(2);

    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    expect(await count()).toBe(1);
    await ctx.http.delete(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    expect(await count()).toBe(2);

    await ctx.http.delete(`/v1/conversations/${g}/members/${a.id}`).set(bearer(a.token)).expect(204);
    expect(await count()).toBe(0);
    // The rows are still stored (nothing was deleted), only masked.
    const stored = await ctx.sql.query(`SELECT count(*)::int AS n FROM message_favorites WHERE user_id = $1`, [a.id]);
    expect(stored.rows[0].n).toBe(3);
  });

  it('is part of the export and erased on purge', async () => {
    const [a, b] = [await user(), await user()];
    const dm = await direct(a, b);
    const m = await send(b, dm, { body: 'à garder' }).expect(201);
    await ctx.http.put(`/v1/messages/${m.body.id}/favorite`).set(bearer(a.token)).expect(204);
    const exp = await ctx.http.get('/v1/me/export').set(bearer(a.token)).expect(200);
    expect(exp.body.favoriteMessages).toEqual([
      expect.objectContaining({ messageId: m.body.id, conversationId: dm, body: 'à garder' }),
    ]);

    await ctx.http.post('/v1/me/deletion-request').set(bearer(a.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [a.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    const left = await ctx.sql.query(`SELECT count(*)::int AS n FROM message_favorites WHERE user_id = $1`, [a.id]);
    expect(left.rows[0].n).toBe(0);
  });
});

describe('disappearing messages', () => {
  it('is set by either participant of a direct and by admins of a group, with a system message each time', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const dm = await direct(a, b);
    const patch = (u: TU, id: string, body: Record<string, unknown>) =>
      ctx.http.patch(`/v1/conversations/${id}`).set(bearer(u.token)).send(body);

    await patch(b, dm, { disappearingSeconds: 3600 }).expect(400);
    await patch(b, dm, { title: 'x' }).expect(403);
    const set = await patch(b, dm, { disappearingSeconds: 86400 }).expect(200);
    expect(set.body.disappearingSeconds).toBe(86400);
    // Same value again: no new system message.
    await patch(a, dm, { disappearingSeconds: 86400 }).expect(200);
    const events = (await messagesOf(a, dm).expect(200)).body.items.filter((m: { kind: string }) => m.kind === 'system');
    expect(events).toHaveLength(1);
    expect(events[0].systemEvent).toMatchObject({ type: 'disappearing_changed', actorId: b.id, seconds: 86400 });

    const g = await group(a, [b, c]);
    await patch(b, g, { disappearingSeconds: 604800 }).expect(403);
    await patch(a, g, { disappearingSeconds: 604800 }).expect(200);
    await patch(a, g, { disappearingSeconds: null }).expect(200);
    expect((await ctx.http.get(`/v1/conversations/${g}`).set(bearer(a.token))).body.disappearingSeconds).toBeNull();
  });

  it('stamps new messages, stops serving expired ones and lets maintenance erase body and media', async () => {
    const [a, b] = [await user(), await user()];
    const dm = await direct(a, b);
    const before = await send(a, dm, { body: 'avant' }).expect(201);
    expect(before.body.expiresAt).toBeNull();
    await ctx.http.patch(`/v1/conversations/${dm}`).set(bearer(a.token)).send({ disappearingSeconds: 86400 }).expect(200);
    const mediaId = await uploadMessageImage(a);
    const text = await send(a, dm, { body: 'éphémère' }).expect(201);
    const media = await send(a, dm, { kind: 'media', mediaId, body: undefined }).expect(201);
    for (const m of [text, media]) {
      const delta = new Date(m.body.expiresAt).getTime() - Date.now();
      expect(delta).toBeGreaterThan(86_300_000);
      expect(delta).toBeLessThanOrEqual(86_400_000);
    }
    const url = media.body.media.contentUrl as string;
    await ctx.http.get(url).set(bearer(b.token)).expect(200);

    await ctx.sql.query(`UPDATE messages SET expires_at = now() - interval '1 minute' WHERE id = ANY($1::uuid[])`, [
      [text.body.id, media.body.id],
    ]);
    const ids = (await messagesOf(b, dm).expect(200)).body.items.map((m: { id: string }) => m.id);
    expect(ids).toContain(before.body.id);
    expect(ids).not.toContain(text.body.id);
    expect(ids).not.toContain(media.body.id);
    await ctx.http.get(url).set(bearer(b.token)).expect(404);
    await ctx.http.put(`/v1/messages/${text.body.id}/favorite`).set(bearer(b.token)).expect(404);
    await ctx.http
      .post('/v1/reports')
      .set(bearer(b.token))
      .send({ targetType: 'message', targetId: text.body.id, reason: 'spam' })
      .expect(404);
    const conv = (await ctx.http.get(`/v1/conversations/${dm}`).set(bearer(b.token)).expect(200)).body;
    expect(conv.lastMessage.id).not.toBe(text.body.id);

    const run = await ctx.app.get(MaintenanceService).runOnce();
    expect(run).toBeDefined();
    const rows = await ctx.sql.query(`SELECT body, media_id FROM messages WHERE id = ANY($1::uuid[])`, [[text.body.id, media.body.id]]);
    expect(rows.rows).toEqual([
      { body: null, media_id: null },
      { body: null, media_id: null },
    ]);
  });
});

describe('scheduled messages', () => {
  const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
  const schedule = (u: TU, convId: string, scheduledAt: string, body: Record<string, unknown> = {}) =>
    send(u, convId, { scheduledAt, ...body });
  const scheduler = () => ctx.app.get(ScheduledMessagesService);
  const inMinutes = (n: number) => new Date(Date.now() + n * 60_000);

  it('validates the window, hides the message until it is sent and lets the author cancel', async () => {
    const [a, b] = [await user(), await user()];
    const dm = await direct(a, b);
    await schedule(a, dm, minutes(0.5)).expect(400);
    await schedule(a, dm, minutes(31 * 24 * 60)).expect(400);
    await schedule(a, dm, new Date(Date.now() - 3600_000).toISOString()).expect(400);

    const cid = randomUUID();
    const when = minutes(10);
    const created = await schedule(a, dm, when, { clientId: cid, body: 'plus tard' }).expect(202);
    expect(created.body).toMatchObject({ conversationId: dm, body: 'plus tard', scheduledAt: when, clientId: cid });
    expect(created.body.seq).toBeUndefined();
    const replay = await schedule(a, dm, when, { clientId: cid, body: 'plus tard' }).expect(200);
    expect(replay.body.id).toBe(created.body.id);

    // Invisible to everyone, including the author, in the conversation: no seq has been attributed.
    expect((await messagesOf(b, dm).expect(200)).body.items).toHaveLength(0);
    expect((await ctx.http.get(`/v1/conversations/${dm}`).set(bearer(a.token)).expect(200)).body.lastSeq).toBe(0);
    const mine = await ctx.http.get('/v1/me/scheduled-messages').set(bearer(a.token)).expect(200);
    expect(mine.body.items.map((i: { id: string }) => i.id)).toEqual([created.body.id]);
    expect((await ctx.http.get('/v1/me/scheduled-messages').set(bearer(b.token)).expect(200)).body.items).toHaveLength(0);

    await ctx.http.delete(`/v1/me/scheduled-messages/${created.body.id}`).set(bearer(b.token)).expect(404);
    await ctx.http.delete(`/v1/me/scheduled-messages/${created.body.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.delete(`/v1/me/scheduled-messages/${created.body.id}`).set(bearer(a.token)).expect(404);
    expect((await scheduler().runOnce(inMinutes(60))).sent).toBe(0);
  });

  it('sends due messages exactly once with a seq at that moment, and honours the disappearing setting', async () => {
    const [a, b] = [await user(), await user()];
    const dm = await direct(a, b);
    await ctx.http.patch(`/v1/conversations/${dm}`).set(bearer(a.token)).send({ disappearingSeconds: 86400 }).expect(200);
    const sysSeq = (await ctx.http.get(`/v1/conversations/${dm}`).set(bearer(a.token))).body.lastSeq as number;
    await schedule(a, dm, minutes(5), { body: 'programmé' }).expect(202);
    await schedule(a, dm, minutes(3000), { body: 'trop tôt' }).expect(202);
    // A draft is consumed by scheduling.
    await ctx.http.put(`/v1/conversations/${dm}/draft`).set(bearer(a.token)).send({ body: 'brouillon' }).expect(200);
    await schedule(a, dm, minutes(4), { body: 'second' }).expect(202);
    await ctx.http.get(`/v1/conversations/${dm}/draft`).set(bearer(a.token)).expect(404);

    expect((await scheduler().runOnce()).sent).toBe(0);
    const [r1, r2] = await Promise.all([scheduler().runOnce(inMinutes(10)), scheduler().runOnce(inMinutes(10))]);
    expect(r1.sent + r2.sent).toBe(2);
    expect((await scheduler().runOnce(inMinutes(10))).sent).toBe(0);

    const items = (await messagesOf(b, dm).expect(200)).body.items as { body: string; seq: number; expiresAt: string | null }[];
    const texts = items.filter((m) => m.body).map((m) => m.body);
    expect(texts.sort()).toEqual(['programmé', 'second']);
    expect(items.filter((m) => m.body).map((m) => m.seq).sort()).toEqual([sysSeq + 1, sysSeq + 2]);
    expect(items.filter((m) => m.body).every((m) => m.expiresAt !== null)).toBe(true);
    expect((await ctx.http.get('/v1/me/scheduled-messages').set(bearer(a.token))).body.items).toHaveLength(1);
  });

  it('cancels and notifies the author when a block or a departure happened meanwhile', async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const dm = await direct(a, b);
    const g = await group(a, [c]);
    await schedule(a, dm, minutes(5), { body: 'secret 1' }).expect(202);
    await schedule(c, g, minutes(5), { body: 'secret 2' }).expect(202);
    await ctx.http.put(`/v1/blocks/${a.id}`).set(bearer(b.token)).expect(204);
    await ctx.http.delete(`/v1/conversations/${g}/members/${c.id}`).set(bearer(c.token)).expect(204);

    const run = await scheduler().runOnce(inMinutes(10));
    expect(run).toEqual({ sent: 0, cancelled: 2 });
    expect((await messagesOf(a, g).expect(200)).body.items.some((m: { body: string | null }) => m.body === 'secret 2')).toBe(false);
    expect((await ctx.http.get(`/v1/conversations/${dm}`).set(bearer(a.token))).body.lastSeq).toBe(0);
    for (const u of [a, c]) {
      expect((await ctx.http.get('/v1/me/scheduled-messages').set(bearer(u.token))).body.items).toHaveLength(0);
      const notes = await ctx.http.get('/v1/notifications').set(bearer(u.token)).expect(200);
      expect(notes.body.items).toHaveLength(1);
      expect(JSON.stringify(notes.body.items[0])).not.toContain('secret');
    }
  });
});

describe('drafts', () => {
  it('keeps one draft per member and conversation, reads it back and drops it on send', async () => {
    const [a, b, outsider] = [await user(), await user(), await user()];
    const dm = await direct(a, b);
    const url = (id: string) => `/v1/conversations/${id}/draft`;
    await ctx.http.get(url(dm)).set(bearer(a.token)).expect(404);
    await ctx.http.put(url(dm)).set(bearer(a.token)).send({ body: '' }).expect(400);
    await ctx.http.put(url(dm)).set(bearer(a.token)).send({ body: 'x'.repeat(4001) }).expect(400);
    await ctx.http.put(url(dm)).set(bearer(outsider.token)).send({ body: 'non' }).expect(404);

    await ctx.http.put(url(dm)).set(bearer(a.token)).send({ body: 'premier' }).expect(200);
    const second = await ctx.http.put(url(dm)).set(bearer(a.token)).send({ body: 'second' }).expect(200);
    expect(second.body).toMatchObject({ conversationId: dm, body: 'second' });
    await ctx.http.put(url(dm)).set(bearer(b.token)).send({ body: 'celui de b' }).expect(200);
    expect((await ctx.http.get(url(dm)).set(bearer(a.token)).expect(200)).body.body).toBe('second');
    expect((await ctx.http.get(url(dm)).set(bearer(b.token)).expect(200)).body.body).toBe('celui de b');

    await send(a, dm, { body: 'envoyé' }).expect(201);
    await ctx.http.get(url(dm)).set(bearer(a.token)).expect(404);
    expect((await ctx.http.get(url(dm)).set(bearer(b.token)).expect(200)).body.body).toBe('celui de b');

    await ctx.http.delete(url(dm)).set(bearer(b.token)).expect(204);
    await ctx.http.delete(url(dm)).set(bearer(b.token)).expect(204);
    await ctx.http.get(url(dm)).set(bearer(b.token)).expect(404);
  });
});
