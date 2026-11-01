import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/common/app-error.js';
import { PrivacyService } from '../src/privacy/privacy.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

/** Signs up a user and returns their token, id and handle. */
async function user(): Promise<{ token: string; id: string; handle: string }> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

describe('privacy settings', () => {
  it('defaults to not discoverable, contact requests from everyone, read receipts on', async () => {
    const a = await user();
    const res = await ctx.http.get('/v1/me/privacy').set(bearer(a.token)).expect(200);
    expect(res.body).toEqual({
      discoverableByPhone: false,
      discoverableByEmail: false,
      contactRequestsFrom: 'everyone',
      readReceipts: true,
    });
  });

  it('applies a partial update, audits it, and rejects invalid patches', async () => {
    const a = await user();
    const res = await ctx.http
      .patch('/v1/me/privacy')
      .set(bearer(a.token))
      .send({ discoverableByPhone: true, contactRequestsFrom: 'nobody' })
      .expect(200);
    expect(res.body).toEqual({
      discoverableByPhone: true,
      discoverableByEmail: false,
      contactRequestsFrom: 'nobody',
      readReceipts: true,
    });
    const again = await ctx.http.get('/v1/me/privacy').set(bearer(a.token)).expect(200);
    expect(again.body).toEqual(res.body);

    const bad = await ctx.http
      .patch('/v1/me/privacy')
      .set(bearer(a.token))
      .send({ contactRequestsFrom: 'friends' })
      .expect(400);
    expect(bad.body.error.code).toBe('validation_failed');
    await ctx.http.patch('/v1/me/privacy').set(bearer(a.token)).send({}).expect(400);
    await ctx.http.patch('/v1/me/privacy').set(bearer(a.token)).send({ readReceipts: 'no' }).expect(400);

    const { rows } = await ctx.sql.query(
      `SELECT metadata FROM audit_events WHERE action = 'user.privacy_updated' AND actor_user_id = $1`,
      [a.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.fields.sort()).toEqual(['contactRequestsFrom', 'discoverableByPhone']);
  });
});

describe('blocks', () => {
  it('hides the profile in both directions and unblocking restores it', async () => {
    const a = await user();
    const b = await user();
    await ctx.http.get(`/v1/users/${b.handle}`).set(bearer(a.token)).expect(200);

    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.get(`/v1/users/${b.handle}`).set(bearer(a.token)).expect(404);
    await ctx.http.get(`/v1/users/${a.handle}`).set(bearer(b.token)).expect(404);
    // Third parties are unaffected.
    const c = await user();
    await ctx.http.get(`/v1/users/${b.handle}`).set(bearer(c.token)).expect(200);

    await ctx.http.delete(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.get(`/v1/users/${b.handle}`).set(bearer(a.token)).expect(200);
    await ctx.http.get(`/v1/users/${a.handle}`).set(bearer(b.token)).expect(200);
  });

  it('is idempotent for PUT and DELETE and lists blocked users', async () => {
    const a = await user();
    const b = await user();
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);

    const list = await ctx.http.get('/v1/blocks').set(bearer(a.token)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.nextCursor).toBeNull();
    expect(list.body.items[0]).toEqual({
      userId: b.id,
      handle: b.handle,
      displayName: 'Test User',
      blockedAt: expect.any(String),
    });
    // The blocked user does not see the block in their own list.
    const theirs = await ctx.http.get('/v1/blocks').set(bearer(b.token)).expect(200);
    expect(theirs.body.items).toEqual([]);

    await ctx.http.delete(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.delete(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    const after = await ctx.http.get('/v1/blocks').set(bearer(a.token)).expect(200);
    expect(after.body.items).toEqual([]);
  });

  it('refuses to block yourself (400) and unknown, inactive or malformed ids (404)', async () => {
    const a = await user();
    const self = await ctx.http.put(`/v1/blocks/${a.id}`).set(bearer(a.token)).expect(400);
    expect(self.body.error.code).toBe('validation_failed');

    await ctx.http.put(`/v1/blocks/${randomUUID()}`).set(bearer(a.token)).expect(404);
    await ctx.http.put('/v1/blocks/not-a-uuid').set(bearer(a.token)).expect(404);
    await ctx.http.delete(`/v1/blocks/${randomUUID()}`).set(bearer(a.token)).expect(404);
    await ctx.http.delete('/v1/blocks/not-a-uuid').set(bearer(a.token)).expect(404);

    const s = await user();
    await ctx.sql.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [s.id]);
    await ctx.http.put(`/v1/blocks/${s.id}`).set(bearer(a.token)).expect(404);
  });

  it('audits block and unblock under the blocker only', async () => {
    const a = await user();
    const b = await user();
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.http.delete(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);

    const { rows } = await ctx.sql.query(
      `SELECT action, subject_user_id, metadata FROM audit_events
        WHERE actor_user_id = $1 AND action IN ('user.blocked', 'user.unblocked') ORDER BY id`,
      [a.id],
    );
    // The repeated PUT changed nothing and is not audited a second time.
    expect(rows.map((r) => r.action)).toEqual(['user.blocked', 'user.unblocked']);
    for (const r of rows) {
      expect(r.subject_user_id).toBe(a.id);
      expect(r.metadata).toEqual({ blockedUserId: b.id });
    }
    // Nothing about the block leaks into the blocked user's security log.
    const log = await ctx.http.get('/v1/me/security-events').set(bearer(b.token)).expect(200);
    expect(log.body.items.map((e: { action: string }) => e.action)).not.toContain('user.blocked');
  });

  it('removes blocks when an account is deleted (ON DELETE CASCADE)', async () => {
    const a = await user();
    const b = await user();
    await ctx.http.put(`/v1/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    await ctx.sql.query('DELETE FROM users WHERE id = $1', [b.id]);
    const { rows } = await ctx.sql.query('SELECT 1 FROM user_blocks WHERE blocker_id = $1', [a.id]);
    expect(rows).toHaveLength(0);
  });

  it('paginates the block list newest first with an opaque cursor (default 50, max 200)', async () => {
    const a = await user();
    const targets = [];
    for (let i = 0; i < 5; i++) targets.push(await user());
    // Identical timestamps exercise the (created_at, blocked_id) tie-breaker.
    for (const t of targets) await ctx.http.put(`/v1/blocks/${t.id}`).set(bearer(a.token)).expect(204);
    await ctx.sql.query(`UPDATE user_blocks SET created_at = now() WHERE blocker_id = $1 AND blocked_id = ANY($2::uuid[])`, [
      a.id,
      targets.slice(1, 4).map((t) => t.id),
    ]);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await ctx.http
        .get('/v1/blocks')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set(bearer(a.token))
        .expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items.map((i: { userId: string }) => i.userId));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(targets.map((t) => t.id)));
    const all = await ctx.http.get('/v1/blocks').set(bearer(a.token)).expect(200);
    expect(all.body.items.map((i: { userId: string }) => i.userId)).toEqual(seen);
    expect(all.body.nextCursor).toBeNull();

    await ctx.http.get('/v1/blocks').query({ limit: 201 }).set(bearer(a.token)).expect(400);
    await ctx.http.get('/v1/blocks').query({ limit: 0 }).set(bearer(a.token)).expect(400);
    await ctx.http.get('/v1/blocks').query({ limit: 200 }).set(bearer(a.token)).expect(200);
    const bad = await ctx.http.get('/v1/blocks').query({ cursor: 'garbage' }).set(bearer(a.token)).expect(400);
    expect(bad.body.error.code).toBe('validation_failed');
  });

  it('maps a target deleted between the check and the insert (FK violation) to 404', async () => {
    const a = await user();
    const privacy = ctx.app.get(PrivacyService);
    // Simulate the race: the existence check passes, then the row is gone at insert time.
    const spy = vi
      .spyOn(privacy as unknown as { assertBlockableTarget(): Promise<void> }, 'assertBlockableTarget')
      .mockResolvedValue(undefined);
    try {
      const err = await privacy.block(a.id, randomUUID(), { ip: null, userAgent: null, requestId: null }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ status: 404, message: 'User not found' });
    } finally {
      spy.mockRestore();
    }
  });
});
