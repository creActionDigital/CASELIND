import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
const follow = (a: { id: string }, b: { id: string }) =>
  ctx.sql.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [a.id, b.id]);

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
  identifier: string;
}

async function user(roles?: string[]): Promise<TU> {
  const { tokens, identifier } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query(`UPDATE users SET roles = $1::text[] WHERE id = $2`, [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, identifier };
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function newStory(u: TU): Promise<string> {
  const up = await ctx.http
    .post('/v1/media/uploads')
    .set(bearer(u.token))
    .send({ purpose: 'story', mime: 'image/png', sizeBytes: TINY_PNG.length })
    .expect(201);
  await ctx.http
    .put(up.body.uploadUrl)
    .set(bearer(u.token))
    .set('X-Upload-Token', up.body.uploadToken)
    .set('Content-Type', 'application/octet-stream')
    .send(TINY_PNG)
    .expect(200);
  const res = await ctx.http.post('/v1/stories').set(bearer(u.token)).send({ clientId: randomUUID(), mediaId: up.body.assetId }).expect(201);
  return res.body.id;
}

async function newMessage(sender: TU, peer: TU, body = 'Texte très privé'): Promise<string> {
  const conv = await ctx.http.post('/v1/conversations').set(bearer(sender.token)).send({ kind: 'direct', userId: peer.id });
  const res = await ctx.http
    .post(`/v1/conversations/${conv.body.id}/messages`)
    .set(bearer(sender.token))
    .send({ clientId: randomUUID(), kind: 'text', body })
    .expect(201);
  return res.body.id;
}

const report = (u: TU, targetType: string, targetId: string, extra: Record<string, unknown> = {}) =>
  ctx.http.post('/v1/reports').set(bearer(u.token)).send({ targetType, targetId, reason: 'spam', ...extra });

const act = (m: TU, targetType: string, targetId: string, action: string, extra: Record<string, unknown> = {}) =>
  ctx.http.post('/v1/admin/moderation/actions').set(bearer(m.token)).send({ targetType, targetId, action, ...extra });

describe('filing reports', () => {
  it('reports a visible story, lists it in my reports, and refuses a duplicate', async () => {
    const [author, fan] = [await user(), await user()];
    await follow(fan, author);
    const sid = await newStory(author);
    const res = await report(fan, 'story', sid, { reason: 'harassment', details: ' trop insistant ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ targetType: 'story', targetId: sid, reason: 'harassment', details: 'trop insistant', status: 'open', resolved: false });
    const dup = await report(fan, 'story', sid);
    expect(dup.status).toBe(409);
    const mine = await ctx.http.get('/v1/me/reports').set(bearer(fan.token)).expect(200);
    expect(mine.body.items.map((r: { id: string }) => r.id)).toEqual([res.body.id]);
    expect((await ctx.http.get('/v1/me/reports').set(bearer(author.token)).expect(200)).body.items).toEqual([]);
  });

  it('answers 404 for an invisible target, an unknown id, an unregistered type; 400 for bad input', async () => {
    const [author, stranger] = [await user(), await user()];
    const sid = await newStory(author);
    expect((await report(stranger, 'story', sid)).status).toBe(404);
    expect((await report(stranger, 'story', randomUUID())).status).toBe(404);
    const [a, b, outsider] = [await user(), await user(), await user()];
    const mid = await newMessage(a, b);
    expect((await report(outsider, 'message', mid)).status).toBe(404);
    expect((await report(stranger, 'story', 'nope')).status).toBe(400);
    expect((await report(stranger, 'story', sid, { reason: 'boring' })).status).toBe(400);
    expect((await report(stranger, 'story', sid, { details: 'x'.repeat(1001) })).status).toBe(400);
    expect((await report(stranger, 'planet', sid)).status).toBe(400);
  });

  it('lets a member report a message and files a new report once the previous one is resolved', async () => {
    const [a, b, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    const mid = await newMessage(a, b);
    expect((await report(b, 'message', mid)).status).toBe(201);
    expect((await report(b, 'message', mid)).status).toBe(409);
    await act(mod, 'message', mid, 'dismiss').expect(200);
    expect((await report(b, 'message', mid)).status).toBe(201);
  });

  it('has its own rate limit', async () => {
    const limited = await createTestContext({ REPORTS_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const { tokens } = await signUp(limited);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const r = await limited.http
          .post('/v1/reports')
          .set(bearer(tokens.accessToken))
          .send({ targetType: 'story', targetId: randomUUID(), reason: 'spam' });
        statuses.push(r.status);
      }
      expect(statuses).toEqual([404, 404, 404, 429, 429]);
      // Other routes are not affected by the reports budget.
      await limited.http.get('/v1/me/reports').set(bearer(tokens.accessToken)).expect(200);
    } finally {
      await limited.close();
    }
  });
});

describe('moderation queue', () => {
  it('is reserved to admin and moderator roles', async () => {
    const [u, mod, admin] = [await user(), await user(['user', 'moderator']), await user(['user', 'admin'])];
    await ctx.http.get('/v1/admin/moderation/reports').set(bearer(u.token)).expect(403);
    await act(u, 'story', randomUUID(), 'hide').expect(403);
    await ctx.http.get('/v1/admin/moderation/reports').expect(401);
    await ctx.http.get('/v1/admin/moderation/reports').set(bearer(mod.token)).expect(200);
    await ctx.http.get('/v1/admin/moderation/reports').set(bearer(admin.token)).expect(200);
    // The audit log stays admin-only.
    await ctx.http.get('/v1/admin/audit-events').set(bearer(mod.token)).expect(403);
  });

  it('groups reports by target with counts and the author, then paginates', async () => {
    const [author, r1, r2, mod] = [await user(), await user(), await user(), await user(['user', 'moderator'])];
    for (const r of [r1, r2]) await follow(r, author);
    const s1 = await newStory(author);
    const s2 = await newStory(author);
    await report(r1, 'story', s1, { reason: 'spam' }).expect(201);
    await report(r2, 'story', s1, { reason: 'scam' }).expect(201);
    await report(r1, 'story', s2).expect(201);

    const page1 = await ctx.http.get('/v1/admin/moderation/reports?targetType=story&limit=1').set(bearer(mod.token)).expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0]).toMatchObject({ targetId: s2, reportCount: 1, authorId: author.id, status: 'open' });
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await ctx.http
      .get(`/v1/admin/moderation/reports?targetType=story&limit=1&cursor=${page1.body.nextCursor}`)
      .set(bearer(mod.token))
      .expect(200);
    expect(page2.body.items[0]).toMatchObject({ targetId: s1, reportCount: 2, authorId: author.id });
    expect(page2.body.items[0].reasons).toEqual(expect.arrayContaining([{ reason: 'spam', count: 1 }, { reason: 'scam', count: 1 }]));

    await act(mod, 'story', s1, 'dismiss').expect(200);
    const open = await ctx.http.get('/v1/admin/moderation/reports?targetType=story').set(bearer(mod.token)).expect(200);
    expect(open.body.items.map((i: { targetId: string }) => i.targetId)).not.toContain(s1);
    const resolved = await ctx.http.get('/v1/admin/moderation/reports?status=resolved&targetType=story').set(bearer(mod.token)).expect(200);
    expect(resolved.body.items.map((i: { targetId: string }) => i.targetId)).toContain(s1);
    await ctx.http.get('/v1/admin/moderation/reports?status=weird').set(bearer(mod.token)).expect(400);
  });
});

describe('moderation actions', () => {
  it('hides a story for everyone but its author, then restores it', async () => {
    const [author, fan, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    await follow(fan, author);
    const sid = await newStory(author);
    await ctx.http.post(`/v1/stories/${sid}/view`).set(bearer(fan.token)).expect(204);
    await report(fan, 'story', sid).expect(201);

    const hidden = await act(mod, 'story', sid, 'hide', { note: 'contenu interne' }).expect(200);
    expect(hidden.body).toEqual({ resolvedReports: 1 });
    await ctx.http.post(`/v1/stories/${sid}/view`).set(bearer(fan.token)).expect(404);
    expect((await ctx.http.get(`/v1/users/${author.id}/stories`).set(bearer(fan.token)).expect(200)).body.items).toEqual([]);
    expect((await report(fan, 'story', sid)).status).toBe(404);
    // The author still sees it in their archive.
    const archive = await ctx.http.get('/v1/me/stories/archive').set(bearer(author.token)).expect(200);
    expect(archive.body.items.map((i: { id: string }) => i.id)).toContain(sid);
    // Hiding twice is harmless.
    await act(mod, 'story', sid, 'hide').expect(200);

    await act(mod, 'story', sid, 'restore').expect(200);
    await ctx.http.post(`/v1/stories/${sid}/view`).set(bearer(fan.token)).expect(204);
  });

  it('recalls a reported message with hide', async () => {
    const [a, b, mod] = [await user(), await user(), await user(['user', 'admin'])];
    const mid = await newMessage(a, b, 'Insulte secrète');
    await report(b, 'message', mid, { reason: 'harassment' }).expect(201);
    await act(mod, 'message', mid, 'hide').expect(200);
    const { rows } = await ctx.sql.query(`SELECT body, recalled_at, media_id FROM messages WHERE id = $1`, [mid]);
    expect(rows[0].body).toBeNull();
    expect(rows[0].recalled_at).not.toBeNull();
    // Recalled messages can no longer be reported.
    expect((await report(a, 'message', mid)).status).toBe(404);
  });

  it('dismiss closes the reports and leaves the item untouched', async () => {
    const [author, fan, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    await follow(fan, author);
    const sid = await newStory(author);
    const rep = await report(fan, 'story', sid).expect(201);
    await act(mod, 'story', sid, 'dismiss').expect(200);
    await ctx.http.post(`/v1/stories/${sid}/view`).set(bearer(fan.token)).expect(204);
    const mine = await ctx.http.get('/v1/me/reports').set(bearer(fan.token)).expect(200);
    expect(mine.body.items.find((r: { id: string }) => r.id === rep.body.id)).toMatchObject({ status: 'resolved', resolved: true });
    expect(JSON.stringify(mine.body)).not.toMatch(/dismiss|hide|restore/);
  });

  it('answers 404 for an unknown target without reports and 400 for a bad action', async () => {
    const mod = await user(['user', 'moderator']);
    await act(mod, 'story', randomUUID(), 'hide').expect(404);
    await act(mod, 'story', randomUUID(), 'ban').expect(400);
  });

  it('audits without content and notifies the reporter without naming anyone', async () => {
    const [a, b, mod] = [await user(), await user(), await user(['user', 'moderator'])];
    const mid = await newMessage(a, b, 'Contenu confidentiel XYZ');
    const rep = await report(b, 'message', mid, { details: 'détail du signalement ABC' }).expect(201);
    await act(mod, 'message', mid, 'hide', { note: 'note interne QRS' }).expect(200);

    const { rows } = await ctx.sql.query(`SELECT actor_user_id, metadata FROM audit_events WHERE action = 'moderation.action' AND metadata->>'targetId' = $1`, [mid]);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(mod.id);
    expect(rows[0].metadata).toEqual({ targetType: 'message', targetId: mid, action: 'hide' });
    expect(JSON.stringify(rows)).not.toMatch(/confidentiel|ABC|QRS/);

    const notes = await ctx.http.get('/v1/notifications').set(bearer(b.token)).expect(200);
    const note = notes.body.items.find((n: { category: string }) => n.category === 'system');
    expect(note).toBeDefined();
    expect(note.data).toEqual({ reportId: rep.body.id });
    expect(JSON.stringify(note)).not.toContain(a.id);
    // The author of the message is not notified.
    const authorNotes = await ctx.http.get('/v1/notifications').set(bearer(a.token)).expect(200);
    expect(authorNotes.body.items.filter((n: { category: string }) => n.category === 'system')).toEqual([]);
  });
});

describe('account data rights', () => {
  it('exports filed reports and anonymises them on purge', async () => {
    const [author, fan] = [await user(), await user()];
    await follow(fan, author);
    const sid = await newStory(author);
    const rep = await report(fan, 'story', sid, { details: 'mon avis' }).expect(201);
    const exp = await ctx.http.get('/v1/me/export').set(bearer(fan.token)).expect(200);
    expect(exp.body.reportsFiled).toEqual([
      expect.objectContaining({ id: rep.body.id, targetType: 'story', targetId: sid, reason: 'spam', details: 'mon avis', status: 'open' }),
    ]);

    await ctx.http.post('/v1/me/deletion-request').set(bearer(fan.token)).send({ password: 'correct-horse-battery' }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '60 days' WHERE id = $1`, [fan.id]);
    const { MaintenanceService } = await import('../src/maintenance/maintenance.service.js');
    await ctx.app.get(MaintenanceService).runOnce();
    const { rows } = await ctx.sql.query(`SELECT reporter_id, details, status FROM reports WHERE id = $1`, [rep.body.id]);
    expect(rows).toEqual([{ reporter_id: null, details: null, status: 'open' }]);
  });
});
