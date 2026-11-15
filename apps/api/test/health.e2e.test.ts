import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthCrypto } from '../src/health/health-crypto.js';
import { HealthService } from '../src/health/health.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

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
const setFlag = (enabled: boolean) => ctx.sql.query(`UPDATE feature_flags SET enabled = $1 WHERE key = 'health'`, [enabled]);
const get = (u: TU, path: string) => ctx.http.get(`/v1/me/health${path}`).set(bearer(u.token));
const send = (method: 'post' | 'put' | 'patch' | 'delete', u: TU, path: string, body?: Record<string, unknown>) => ctx.http[method](`/v1/me/health${path}`).set(bearer(u.token)).send(body ?? {});
const consent = (u: TU) => send('put', u, '/consent', { version: '1' });
const entry = (extra: Record<string, unknown> = {}) => ({ kind: 'allergy', recordedOn: '2026-01-10', title: 'Pénicilline', details: 'Éruption cutanée', ...extra });
const addEntry = (u: TU, body: Record<string, unknown> = entry()) => send('post', u, '/entries', body);
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);
const reminder = (extra: Record<string, unknown> = {}) => ({ title: 'Amoxicilline', dose: '500 mg', times: ['20:00', '08:00', '08:00'], utcOffsetMinutes: 120, startsOn: '2026-11-01', endsOn: null, ...extra });
async function consenting(): Promise<TU> {
  const u = await user();
  await consent(u).expect(200);
  return u;
}

describe('personal health: flag and consent (lot 18a)', () => {
  it('is a regulated flag, off by default', async () => {
    const res = await ctx.sql.query(`SELECT enabled, regulated FROM feature_flags WHERE key = 'health'`);
    expect(res.rows[0]).toEqual({ enabled: false, regulated: true });
    const u = await user();
    expect((await get(u, '/consent')).status).toBe(403); // flag off: nothing is reachable
    expect((await get(u, '/consent')).body.error.code).toBe('feature_disabled');
  });

  describe('with the module on', () => {
    beforeAll(() => setFlag(true));
    afterAll(() => setFlag(false));

    it('needs a session; nothing works before explicit consent; the version must be current', async () => {
      await ctx.http.get('/v1/me/health/consent').expect(401);
      const u = await user();
      expect((await get(u, '/consent').expect(200)).body).toEqual({ granted: false, version: null, grantedAt: null });
      for (const res of [await get(u, '/entries'), await addEntry(u), await get(u, '/reminders'), await get(u, '/doses'), await send('post', u, '/reminders', reminder())]) {
        expect(res.status).toBe(403);
        expect(res.body.error.details.reason).toBe('consent_required');
      }
      expect((await send('put', u, '/consent', { version: '0' }).expect(409)).body.error.details).toMatchObject({ reason: 'consent_version', current: '1' });
      const granted = (await consent(u).expect(200)).body;
      expect(granted).toMatchObject({ granted: true, version: '1' });
      await consent(u).expect(200); // idempotent
      expect((await get(u, '/consent').expect(200)).body.grantedAt).toBe(granted.grantedAt);
    });

    it('withdrawing consent hides the data again; consenting back restores it; erasing wipes everything', async () => {
      const u = await consenting();
      await addEntry(u).expect(201);
      await send('post', u, '/reminders', reminder()).expect(201);
      await send('delete', u, '/consent').expect(200);
      expect((await get(u, '/entries')).status).toBe(403);
      await consent(u).expect(200);
      expect((await get(u, '/entries').expect(200)).body.items).toHaveLength(1);

      await send('delete', u, '/data').expect(204);
      expect((await get(u, '/consent').expect(200)).body.granted).toBe(false);
      await consent(u).expect(200);
      expect((await get(u, '/entries').expect(200)).body.items).toEqual([]);
      expect((await get(u, '/reminders').expect(200)).body.items).toEqual([]);
      expect((await ctx.sql.query('SELECT count(*)::int AS n FROM health_entries WHERE user_id = $1', [u.id])).rows[0].n).toBe(0);
    });

    it('records entries: validates, pages by date, filters by kind, edits keeping untouched fields, deletes', async () => {
      const u = await consenting();
      await addEntry(u, entry({ title: '' })).expect(400);
      await addEntry(u, entry({ kind: 'cancer' })).expect(400);
      await addEntry(u, entry({ recordedOn: '10/01/2026' })).expect(400);
      await addEntry(u, entry({ severity: 3 })).expect(400); // severity is for symptoms only
      await addEntry(u, entry({ kind: 'symptom', severity: 6 })).expect(400);
      const a = (await addEntry(u).expect(201)).body;
      expect(a).toMatchObject({ kind: 'allergy', title: 'Pénicilline', details: 'Éruption cutanée', severity: null, recordedOn: '2026-01-10' });
      const s = (await addEntry(u, entry({ kind: 'symptom', title: 'Toux', details: '', severity: 2, recordedOn: '2026-02-01' })).expect(201)).body;
      const m = (await addEntry(u, entry({ kind: 'medication', title: 'Metformine', recordedOn: '2026-03-01' })).expect(201)).body;

      expect(ids(await get(u, '/entries').expect(200))).toEqual([m.id, s.id, a.id]); // newest date first
      expect(ids(await get(u, '/entries?kind=symptom').expect(200))).toEqual([s.id]);
      const p1 = await get(u, '/entries?limit=2').expect(200);
      expect(ids(await get(u, `/entries?limit=2&cursor=${p1.body.nextCursor}`).expect(200))).toEqual([a.id]);
      await get(u, '/entries?cursor=x').expect(400);

      const edited = (await send('patch', u, `/entries/${s.id}`, { severity: 4 }).expect(200)).body;
      expect(edited).toMatchObject({ title: 'Toux', severity: 4, recordedOn: '2026-02-01' });
      await send('patch', u, `/entries/${a.id}`, { severity: 2 }).expect(400); // an allergy has no severity
      await send('delete', u, `/entries/${a.id}`).expect(204);
      await send('delete', u, `/entries/${a.id}`).expect(204);
      expect(ids(await get(u, '/entries').expect(200))).toEqual([m.id, s.id]);
    });

    it('keeps the record private: others get nothing and 404, even when they consented too', async () => {
      const [a, b] = [await consenting(), await consenting()];
      const e = (await addEntry(a).expect(201)).body;
      expect((await get(b, '/entries').expect(200)).body.items).toEqual([]);
      await send('patch', b, `/entries/${e.id}`, { title: 'Pirate' }).expect(404);
      await send('delete', b, `/entries/${e.id}`).expect(204); // no effect on someone else's data
      expect((await get(a, '/entries').expect(200)).body.items).toHaveLength(1);
    });

    it('encrypts the free text at rest, bound to its owner', async () => {
      const u = await consenting();
      const other = await user();
      const e = (await addEntry(u, entry({ title: 'Diabète de type 2', details: 'Suivi mensuel secret' })).expect(201)).body;
      const row = (await ctx.sql.query('SELECT payload FROM health_entries WHERE id = $1', [e.id])).rows[0].payload as string;
      expect(row).toMatch(/^v1:/);
      expect(row).not.toContain('Diabète');
      expect(row).not.toContain('secret');
      await send('post', u, '/reminders', reminder({ title: 'Insuline Lantus' })).expect(201);
      const rem = (await ctx.sql.query('SELECT payload FROM health_reminders WHERE user_id = $1', [u.id])).rows[0].payload as string;
      expect(rem).not.toContain('Lantus');
      const crypto = ctx.app.get(HealthCrypto);
      expect(crypto.open<{ title: string }>(u.id, row).title).toBe('Diabète de type 2');
      expect(() => crypto.open(other.id, row)).toThrow(); // a ciphertext copied to another account does not open
    });

    it('reminders: validates, sorts the times, sends one generic notification per due time (idempotent, offset-aware, catch-up)', async () => {
      const u = await consenting();
      const svc = ctx.app.get(HealthService);
      await send('post', u, '/reminders', reminder({ times: ['25:00'] })).expect(400);
      await send('post', u, '/reminders', reminder({ times: [] })).expect(400);
      await send('post', u, '/reminders', reminder({ endsOn: '2026-10-01' })).expect(400);
      const r = (await send('post', u, '/reminders', reminder()).expect(201)).body;
      expect(r).toMatchObject({ title: 'Amoxicilline', dose: '500 mg', times: ['08:00', '20:00'], active: true, utcOffsetMinutes: 120 });

      const doseCount = async () => Number((await ctx.sql.query('SELECT count(*)::int AS n FROM health_doses WHERE user_id = $1', [u.id])).rows[0].n);
      const at = async (iso: string) => {
        await svc.runDue(new Date(iso));
        return doseCount();
      };
      expect(await at('2026-11-15T05:00:00Z')).toBe(0); // 07:00 in Goma: nothing due
      expect(await at('2026-11-15T06:00:00Z')).toBe(1); // 08:00 in Goma
      expect(await at('2026-11-15T06:00:00Z')).toBe(1); // same minute again: no second dose
      expect(await at('2026-11-15T06:03:00Z')).toBe(1); // catching up the same dose
      expect(await at('2026-11-15T18:02:00Z')).toBe(2); // 20:02 local: the 20:00 dose, 2 minutes late
      expect(await at('2026-11-15T18:30:00Z')).toBe(2); // too late to catch up

      const notes = await ctx.sql.query(`SELECT title, body FROM notifications WHERE user_id = $1 AND category = 'reminder'`, [u.id]);
      expect(notes.rows).toHaveLength(2);
      expect(JSON.stringify(notes.rows)).not.toContain('Amoxicilline');
      expect(JSON.stringify(notes.rows)).not.toContain('500');

      const doses = (await get(u, '/doses').expect(200)).body.items;
      expect(doses).toHaveLength(2);
      expect(doses[0]).toMatchObject({ title: 'Amoxicilline', dose: '500 mg', status: 'pending', dueAt: '2026-11-15T18:00:00.000Z' });
      expect((await send('post', u, `/doses/${doses[0].id}/taken`).expect(200)).body.status).toBe('taken');
      expect((await send('post', u, `/doses/${doses[1].id}/skip`).expect(200)).body.status).toBe('skipped');
      const stranger = await consenting();
      await send('post', stranger, `/doses/${doses[0].id}/taken`).expect(404);
      await send('post', u, '/doses/00000000-0000-4000-8000-000000000000/taken').expect(404);
    });

    it('reminders respect the period, pausing and consent', async () => {
      const u = await consenting();
      const svc = ctx.app.get(HealthService);
      const doseCount = async () => Number((await ctx.sql.query('SELECT count(*)::int AS n FROM health_doses WHERE user_id = $1', [u.id])).rows[0].n);
      const at = async (iso: string) => {
        await svc.runDue(new Date(iso));
        return doseCount();
      };
      const r = (await send('post', u, '/reminders', reminder({ startsOn: '2026-12-05', endsOn: '2026-12-06', times: ['08:00'] })).expect(201)).body;
      expect(await at('2026-12-04T06:00:00Z')).toBe(0); // before the start date
      expect(await at('2026-12-07T06:00:00Z')).toBe(0); // after the end date
      expect(await at('2026-12-05T06:00:00Z')).toBe(1); // inside
      const paused = (await send('patch', u, `/reminders/${r.id}`, { active: false }).expect(200)).body;
      expect(paused.active).toBe(false);
      expect(await at('2026-12-06T06:00:00Z')).toBe(1); // paused: nothing new
      await send('patch', u, `/reminders/${r.id}`, { active: true }).expect(200);
      await send('delete', u, '/consent').expect(200);
      expect(await at('2026-12-06T06:00:00Z')).toBe(1); // no consent: nothing new
      await consent(u).expect(200);
      await send('delete', u, `/reminders/${r.id}`).expect(204);
      await send('delete', u, `/reminders/${r.id}`).expect(204);
      expect((await get(u, '/doses').expect(200)).body.items).toEqual([]); // doses go with their reminder
    });

    it('audits without any health content and exports the account\'s own decrypted data', async () => {
      const u = await consenting();
      await addEntry(u, entry({ title: 'Asthme', details: 'Ventoline si besoin' })).expect(201);
      await send('post', u, '/reminders', reminder({ title: 'Ventoline' })).expect(201);
      const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE subject_user_id = $1 AND action LIKE 'health.%' ORDER BY occurred_at`, [u.id]);
      expect(audits.rows.map((r: { action: string }) => r.action)).toEqual(['health.consent_granted', 'health.entry_created', 'health.reminder_created']);
      for (const word of ['Asthme', 'Ventoline', 'allergy']) expect(JSON.stringify(audits.rows.slice(2))).not.toContain(word);

      const exp = (await ctx.http.get('/v1/me/export').set(bearer(u.token)).expect(200)).body.health;
      expect(exp.consent.granted).toBe(true);
      expect(exp.entries).toEqual([{ kind: 'allergy', recordedOn: '2026-01-10', title: 'Asthme', details: 'Ventoline si besoin', severity: null }]);
      expect(exp.reminders[0]).toMatchObject({ title: 'Ventoline', times: ['08:00', '20:00'] });
      const stranger = await user();
      expect((await ctx.http.get('/v1/me/export').set(bearer(stranger.token)).expect(200)).body.health).toMatchObject({ consent: { granted: false }, entries: [], reminders: [] });
    });
  });
});
