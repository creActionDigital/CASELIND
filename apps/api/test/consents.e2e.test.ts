import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSENT_KINDS } from '@caselind/contracts';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

async function user() {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id as string };
}
type U = Awaited<ReturnType<typeof user>>;
const put = (u: U, kind: string, granted: boolean) => ctx.http.put(`/v1/me/consents/${kind}`).set(bearer(u.token)).send({ granted });
const items = async (u: U) => (await ctx.http.get('/v1/me/consents').set(bearer(u.token)).expect(200)).body.items as { kind: string; granted: boolean; version: string | null; updatedAt: string | null }[];
const history = async (u: U) => (await ctx.http.get('/v1/me/consents/history').set(bearer(u.token)).expect(200)).body.items as { kind: string; granted: boolean; version: string }[];
const journalRows = async (id: string) => (await ctx.sql.query(`SELECT kind, granted FROM user_consents WHERE user_id = $1 ORDER BY seq`, [id])).rows;

describe('central consents', () => {
  it('needs a session; lists every whitelisted kind, nothing granted at first', async () => {
    await ctx.http.get('/v1/me/consents').expect(401);
    await ctx.http.get('/v1/me/consents/history').expect(401);
    await ctx.http.put('/v1/me/consents/analytics').send({ granted: true }).expect(401);
    const u = await user();
    const list = await items(u);
    expect(list.map((i) => i.kind)).toEqual([...CONSENT_KINDS]);
    expect(list.every((i) => !i.granted && i.version === null && i.updatedAt === null)).toBe(true);
    expect(await history(u)).toEqual([]);
  });

  it('rejects a kind outside the whitelist and a bad body with 400; unknown routes stay 404', async () => {
    const u = await user();
    expect((await put(u, 'selling_my_soul', true)).status).toBe(400);
    await ctx.http.put('/v1/me/consents/analytics').set(bearer(u.token)).send({ granted: 'yes' }).expect(400);
    await ctx.http.put('/v1/me/consents/analytics').set(bearer(u.token)).send({}).expect(400);
    await ctx.http.get('/v1/me/consents/analytics/nope').set(bearer(u.token)).expect(404);
    expect(await journalRows(u.id)).toEqual([]);
  });

  it('journals each change append-only; current state is the last line; same answer twice adds nothing', async () => {
    const u = await user();
    expect((await put(u, 'analytics', true).expect(200)).body).toMatchObject({ kind: 'analytics', granted: true, version: '1' });
    await put(u, 'analytics', true).expect(200);
    await put(u, 'analytics', false).expect(200);
    await put(u, 'translation', true).expect(200);
    expect((await items(u)).filter((i) => i.granted).map((i) => i.kind)).toEqual(['translation']);
    const h = await history(u);
    expect(h.map((e) => `${e.kind}:${e.granted}`)).toEqual(['translation:true', 'analytics:false', 'analytics:true']); // most recent first
    expect(h.every((e) => e.version === '1')).toBe(true);
    // The journal refuses edits.
    await expect(ctx.sql.query(`UPDATE user_consents SET granted = NOT granted WHERE user_id = $1`, [u.id])).rejects.toThrow(/append-only/);
    // Audit carries the kind and the answer, nothing else.
    const ev = (await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'user.consent_updated' AND actor_user_id = $1 ORDER BY occurred_at, id`, [u.id])).rows;
    expect(ev.map((e) => e.metadata)).toEqual([{ kind: 'analytics', granted: true }, { kind: 'analytics', granted: true }, { kind: 'analytics', granted: false }, { kind: 'translation', granted: true }]); // every request is audited, the journal only keeps changes
    // Another user sees none of it.
    expect(await history(await user())).toEqual([]);
  });

  it('marketing goes through the loyalty store and stays in sync both ways', async () => {
    const u = await user();
    await put(u, 'marketing', true).expect(200);
    expect((await ctx.sql.query(`SELECT opted_in FROM marketing_consents WHERE user_id = $1`, [u.id])).rows[0].opted_in).toBe(true);
    expect((await ctx.http.get('/v1/me/consents').set(bearer(u.token))).body.marketing).toBe(true);
    // Legacy endpoint: also journaled and reflected.
    await ctx.http.put('/v1/me/marketing-consent').set(bearer(u.token)).send({ optIn: false }).expect(200);
    expect((await items(u)).find((i) => i.kind === 'marketing')).toMatchObject({ granted: false });
    expect((await ctx.http.get('/v1/me/consents').set(bearer(u.token))).body.marketing).toBe(false);
    expect(await journalRows(u.id)).toEqual([{ kind: 'marketing', granted: true }, { kind: 'marketing', granted: false }]);
  });

  describe('health keeps its current effect', () => {
    beforeAll(() => ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'health'`));
    afterAll(() => ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'health'`));

    it('withdrawing hides the health data again, regranting restores it; the old endpoints are journaled too', async () => {
      const u = await user();
      const entries = () => ctx.http.get('/v1/me/health/entries').set(bearer(u.token));
      expect((await entries()).status).toBe(403);
      expect((await put(u, 'health', true).expect(200)).body).toMatchObject({ kind: 'health', granted: true, version: '1' });
      expect((await entries()).status).toBe(200);
      await ctx.http.post('/v1/me/health/entries').set(bearer(u.token)).send({ kind: 'note', recordedOn: '2026-01-10', title: 'x', details: 'y' }).expect(201);
      expect((await put(u, 'health', false).expect(200)).body).toMatchObject({ granted: false });
      const hidden = await entries();
      expect(hidden.status).toBe(403);
      expect(hidden.body.error.details.reason).toBe('consent_required');
      expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM health_entries WHERE user_id = $1`, [u.id])).rows[0].n).toBe(1); // data stays
      // Old endpoints still work and feed the journal.
      await ctx.http.put('/v1/me/health/consent').set(bearer(u.token)).send({ version: '1' }).expect(200);
      expect((await items(u)).find((i) => i.kind === 'health')).toMatchObject({ granted: true, version: '1' });
      await ctx.http.delete('/v1/me/health/consent').set(bearer(u.token)).expect(200);
      expect((await items(u)).find((i) => i.kind === 'health')?.granted).toBe(false);
      expect((await journalRows(u.id)).map((r) => r.granted)).toEqual([true, false, true, false]);
      expect((await entries()).status).toBe(403);
    });
  });

  it('the export carries the journal; the purge erases it', async () => {
    const u = await user();
    await put(u, 'ai_processing', true).expect(200);
    await put(u, 'ai_processing', false).expect(200);
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(u.token)).expect(200)).body;
    expect(exp.consentJournal.map((e: { kind: string; granted: boolean }) => `${e.kind}:${e.granted}`)).toEqual(['ai_processing:false', 'ai_processing:true']);
    const keep = await user();
    await put(keep, 'analytics', true).expect(200);
    await ctx.http.post('/v1/me/deletion-request').set(bearer(u.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [u.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect(await journalRows(u.id)).toEqual([]);
    expect(await journalRows(keep.id)).toHaveLength(1);
  });

  it('the journal refuses DELETE and TRUNCATE outside the account purge', async () => {
    const u = await user();
    await put(u, 'analytics', true).expect(200);
    await expect(ctx.sql.query(`DELETE FROM user_consents WHERE user_id = $1`, [u.id])).rejects.toThrow(/append-only/);
    await expect(ctx.sql.query(`TRUNCATE user_consents`)).rejects.toThrow(/append-only/);
    expect(await journalRows(u.id)).toHaveLength(1);
  });

  it('parallel identical answers add one line; the export has the whole journal beyond 200 lines', async () => {
    const u = await user();
    await Promise.all([1, 2, 3, 4, 5].map(() => put(u, 'translation', true)));
    expect(await journalRows(u.id)).toEqual([{ kind: 'translation', granted: true }]);
    await ctx.sql.query(
      `INSERT INTO user_consents (user_id, kind, granted, version) SELECT $1, 'analytics', (n % 2 = 0), '1' FROM generate_series(1, 250) n`,
      [u.id],
    );
    expect((await history(u)).length).toBe(200);
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(u.token)).expect(200)).body;
    expect(exp.consentJournal).toHaveLength(251);
  });

  it('a legacy consent without a journal line is still reported granted', async () => {
    const u = await user();
    await ctx.sql.query(`INSERT INTO health_consents (user_id, version) VALUES ($1, '1')`, [u.id]);
    expect((await items(u)).find((i) => i.kind === 'health')).toMatchObject({ granted: true, version: '1' });
  });
});
