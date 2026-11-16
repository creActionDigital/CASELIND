import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
  await setFlag('health', true);
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
}
async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id };
}
const setFlag = (key: string, enabled: boolean) => ctx.sql.query('UPDATE feature_flags SET enabled = $1 WHERE key = $2', [enabled, key]);
const api = (method: 'get' | 'post' | 'put' | 'delete', u: TU, path: string, body?: Record<string, unknown>) => ctx.http[method](`/v1${path}`).set(bearer(u.token)).send(body ?? {});
const consenting = async () => {
  const u = await user();
  await api('put', u, '/me/health/consent', { version: '1' }).expect(200);
  return u;
};
const entry = (extra: Record<string, unknown> = {}) => ({ kind: 'allergy', recordedOn: '2026-01-10', title: 'Pénicilline', details: 'Éruption', ...extra });
const future = (days = 3) => new Date(Date.now() + days * 86_400_000).toISOString();
const application = (extra: Record<string, unknown> = {}) => ({ kind: 'doctor', specialty: 'Médecine générale', licenseNumber: 'CNOM-12345', city: 'Goma', bio: 'Consultations adultes', ...extra });

/** An approved professional (admin verified the licence). */
async function approvedPro(extra: Record<string, unknown> = {}): Promise<{ pro: TU; admin: TU }> {
  const [pro, admin] = [await user(), await user(['user', 'admin'])];
  await api('put', pro, '/me/health/professional', application(extra)).expect(200);
  await api('post', admin, `/admin/health/professionals/${pro.id}/review`, { decision: 'approve', note: 'Agrément vérifié' }).expect(204);
  return { pro, admin };
}
/** Makes an appointment start in the past so it can be completed. */
const startedAgo = (id: string) => ctx.sql.query(`UPDATE health_appointments SET starts_at = now() - interval '1 hour' WHERE id = $1`, [id]);
const ids = (res: { body: { items: { userId?: string; id?: string }[] } }) => res.body.items.map((i) => i.userId ?? i.id);

describe('health professionals (lot 18b)', () => {
  it('lists nobody before an administrator verified the licence; the licence number stays private', async () => {
    const [pro, admin, patient] = [await user(), await user(['user', 'admin']), await consenting()];
    await api('put', pro, '/me/health/professional', application({ licenseNumber: 'ab' })).expect(400);
    await api('put', pro, '/me/health/professional', application({ kind: 'wizard' })).expect(400);
    const applied = (await api('put', pro, '/me/health/professional', application()).expect(200)).body;
    expect(applied.profile).toMatchObject({ status: 'pending', licenseNumber: 'CNOM-12345' });
    expect(ids(await api('get', patient, '/health-professionals').expect(200))).not.toContain(pro.id);
    await api('post', pro, `/admin/health/professionals/${pro.id}/review`, { decision: 'approve' }).expect(403); // not an admin
    expect((await api('get', pro, '/admin/health/professionals?status=pending')).status).toBe(403);
    const pending = (await api('get', admin, '/admin/health/professionals?status=pending').expect(200)).body.items;
    expect(pending.find((p: { userId: string }) => p.userId === pro.id)).toMatchObject({ licenseNumber: 'CNOM-12345', status: 'pending' });

    await api('post', admin, `/admin/health/professionals/${pro.id}/review`, { decision: 'reject', note: 'Licence illisible' }).expect(204);
    expect((await api('get', pro, '/me/health/professional')).body.profile).toMatchObject({ status: 'rejected', reviewNote: 'Licence illisible' });
    await api('put', pro, '/me/health/professional', application({ licenseNumber: 'CNOM-99999' })).expect(200); // can try again
    await api('post', admin, `/admin/health/professionals/${pro.id}/review`, { decision: 'approve' }).expect(204);
    await api('put', pro, '/me/health/professional', application()).expect(409); // already reviewed
    const listed = (await api('get', patient, '/health-professionals').expect(200)).body.items.find((p: { userId: string }) => p.userId === pro.id);
    expect(listed).toMatchObject({ kind: 'doctor', city: 'Goma', specialty: 'Médecine générale' });
    expect(JSON.stringify(listed)).not.toContain('CNOM');
    await api('post', admin, '/admin/health/professionals/00000000-0000-4000-8000-000000000000/review', { decision: 'approve' }).expect(404);
  });

  it('filters the directory, hides blocked professionals and the caller themselves', async () => {
    const { pro } = await approvedPro({ kind: 'dentist', city: 'Bukavu', specialty: 'Orthodontie 100%' });
    const patient = await consenting();
    const list = (qs: string) => api('get', patient, `/health-professionals${qs}`);
    expect(ids(await list('?kind=dentist&city=bukavu'))).toContain(pro.id);
    expect(ids(await list('?kind=laboratory'))).not.toContain(pro.id);
    expect(ids(await list('?q=%25'))).toEqual([pro.id]); // the wildcard is literal
    const p1 = await list('?limit=1').expect(200);
    expect(p1.body.items).toHaveLength(1);
    await list('?cursor=x').expect(400);
    expect(ids(await api('get', pro, '/health-professionals').expect(200))).not.toContain(pro.id);
    await api('put', pro, `/blocks/${patient.id}`).expect(204);
    expect(ids(await list('')).includes(pro.id)).toBe(false);
  });
});

describe('appointments (lot 18b)', () => {
  it('needs consent, an approved professional, a future date; the reason is sealed', async () => {
    const { pro } = await approvedPro();
    const noConsent = await user();
    expect((await api('post', noConsent, '/me/health/appointments', { professionalId: pro.id, startsAt: future(), reason: 'Toux' }).expect(403)).body.error.details.reason).toBe('consent_required');
    const patient = await consenting();
    const book = (extra: Record<string, unknown> = {}) => api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: future(), reason: 'Toux persistante', ...extra });
    await book({ startsAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
    await book({ startsAt: future(400) }).expect(400);
    await book({ startsAt: 'demain' }).expect(400);
    await book({ professionalId: patient.id }).expect(403);
    const stranger = await user();
    await book({ professionalId: stranger.id }).expect(404); // not a professional
    const a = (await book().expect(201)).body;
    expect(a).toMatchObject({ status: 'requested', mode: 'in_person', role: 'patient', reason: 'Toux persistante', other: { id: pro.id }, hasPrescription: false });
    const raw = (await ctx.sql.query('SELECT reason_enc FROM health_appointments WHERE id = $1', [a.id])).rows[0].reason_enc as string;
    expect(raw).toMatch(/^v1:/);
    expect(raw).not.toContain('Toux');
    expect((await api('get', pro, '/me/health/professional/appointments').expect(200)).body.items[0]).toMatchObject({ id: a.id, role: 'professional', reason: 'Toux persistante', other: { id: patient.id } });
    expect(ids(await api('get', patient, '/me/health/appointments').expect(200))).toEqual([a.id]);
  });

  it('teleconsultation needs its regulated flag', async () => {
    const { pro } = await approvedPro();
    const patient = await consenting();
    const body = { professionalId: pro.id, startsAt: future(), mode: 'teleconsultation', reason: 'Suivi' };
    const off = await api('post', patient, '/me/health/appointments', body).expect(403);
    expect(off.body.error.code).toBe('feature_disabled');
    await setFlag('health.teleconsultation', true);
    try {
      await api('post', patient, '/me/health/appointments', body).expect(201);
    } finally {
      await setFlag('health.teleconsultation', false);
    }
  });

  it('professional confirms, declines or completes; either side cancels; one confirmed per instant; others see nothing', async () => {
    const { pro } = await approvedPro();
    const [p1, p2, stranger] = [await consenting(), await consenting(), await consenting()];
    const when = future(5);
    const a1 = (await api('post', p1, '/me/health/appointments', { professionalId: pro.id, startsAt: when }).expect(201)).body;
    const a2 = (await api('post', p2, '/me/health/appointments', { professionalId: pro.id, startsAt: when }).expect(201)).body;
    await api('post', p1, `/health/appointments/${a1.id}/confirm`).expect(404); // the patient cannot confirm
    await api('post', stranger, `/health/appointments/${a1.id}/cancel`).expect(404);
    await api('post', stranger, `/health/appointments/${a1.id}/confirm`).expect(404);
    expect((await api('post', pro, `/health/appointments/${a1.id}/confirm`).expect(200)).body.status).toBe('confirmed');
    expect((await api('post', pro, `/health/appointments/${a2.id}/confirm`).expect(409)).body.error.details.reason).toBe('slot_taken');
    expect((await api('post', pro, `/health/appointments/${a2.id}/decline`).expect(200)).body.status).toBe('declined');
    await api('post', pro, `/health/appointments/${a2.id}/confirm`).expect(409); // already declined
    await api('post', pro, `/health/appointments/${a1.id}/complete`).expect(409); // has not started
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND category = 'booking'`, [p1.id])).rows[0].n).toBe(1);

    expect((await api('post', p1, `/health/appointments/${a1.id}/cancel`).expect(200)).body.status).toBe('cancelled');
    await api('post', p1, `/health/appointments/${a1.id}/cancel`).expect(200); // idempotent
    await api('post', pro, `/health/appointments/${a1.id}/complete`).expect(409);
    const a3 = (await api('post', p1, '/me/health/appointments', { professionalId: pro.id, startsAt: future(6) }).expect(201)).body;
    await api('post', pro, `/health/appointments/${a3.id}/confirm`).expect(200);
    await startedAgo(a3.id);
    expect((await api('post', pro, `/health/appointments/${a3.id}/complete`).expect(200)).body.status).toBe('completed');
  });
});

describe('sharing the record with a professional (lot 18b)', () => {
  it('shows nothing without an active share, then only the chosen kinds, logging every read for the patient', async () => {
    const { pro } = await approvedPro();
    const patient = await consenting();
    await api('post', patient, '/me/health/entries', entry()).expect(201);
    await api('post', patient, '/me/health/entries', entry({ kind: 'condition', title: 'Diabète', recordedOn: '2026-02-01' })).expect(201);
    await api('post', patient, '/me/health/entries', entry({ kind: 'note', title: 'Note intime', recordedOn: '2026-03-01' })).expect(201);
    const read = () => api('get', pro, `/me/health/professional/patients/${patient.id}/record`);
    await read().expect(404); // never shared

    await api('post', patient, '/me/health/shares', { professionalId: pro.id, kinds: [] }).expect(400);
    await api('post', patient, '/me/health/shares', { professionalId: pro.id, kinds: ['allergy'], days: 31 }).expect(400);
    await api('post', patient, '/me/health/shares', { professionalId: patient.id, kinds: ['allergy'] }).expect(403);
    const noPro = await user();
    await api('post', patient, '/me/health/shares', { professionalId: noPro.id, kinds: ['allergy'] }).expect(404);
    const share = (await api('post', patient, '/me/health/shares', { professionalId: pro.id, kinds: ['allergy', 'condition', 'allergy'], days: 2 }).expect(201)).body;
    expect(share).toMatchObject({ active: true, kinds: ['allergy', 'condition'], revokedAt: null });

    const patients = (await api('get', pro, '/me/health/professional/patients').expect(200)).body.items;
    expect(patients.map((p: { patient: { id: string } }) => p.patient.id)).toContain(patient.id);
    const rec = (await read().expect(200)).body;
    expect(rec.entries.map((e: { title: string }) => e.title)).toEqual(['Diabète', 'Pénicilline']); // the note stays private
    expect(JSON.stringify(rec)).not.toContain('intime');
    await read().expect(200);

    const log = (await api('get', patient, '/me/health/access-log').expect(200)).body.items;
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ accessor: { id: pro.id }, entriesCount: 2 });
    expect(JSON.stringify(log)).not.toContain('Diabète');
    const stranger = await user();
    await api('get', stranger, `/me/health/professional/patients/${patient.id}/record`).expect(404);
    expect((await api('get', pro, `/me/health/professional/patients/${stranger.id}/record`)).status).toBe(404);
  });

  it('revoking, expiry, a new share, the patient withdrawing consent and a suspension each cut access', async () => {
    const { pro, admin } = await approvedPro();
    const patient = await consenting();
    await api('post', patient, '/me/health/entries', entry()).expect(201);
    const read = () => api('get', pro, `/me/health/professional/patients/${patient.id}/record`);
    const share = (kinds: string[] = ['allergy']) => api('post', patient, '/me/health/shares', { professionalId: pro.id, kinds }).expect(201);

    const s1 = (await share()).body;
    await read().expect(200);
    expect((await api('delete', patient, `/me/health/shares/${s1.id}`).expect(200)).body.active).toBe(false);
    await api('delete', patient, `/me/health/shares/${s1.id}`).expect(200); // idempotent
    await read().expect(404);
    const stranger = await user();
    await api('delete', stranger, `/me/health/shares/${s1.id}`).expect(404);

    const s2 = (await share(['allergy'])).body;
    const s3 = (await share(['condition'])).body; // replaces s2
    expect((await api('get', patient, '/me/health/shares').expect(200)).body.items.find((s: { id: string }) => s.id === s2.id).active).toBe(false);
    expect((await read().expect(200)).body.entries).toEqual([]); // only conditions are shared now, none stored

    await ctx.sql.query(`UPDATE health_shares SET expires_at = now() - interval '1 minute' WHERE id = $1`, [s3.id]);
    await read().expect(404);

    await share();
    await read().expect(200);
    await api('delete', patient, '/me/health/consent').expect(200);
    await read().expect(404); // consent withdrawn: nothing is readable
    await api('put', patient, '/me/health/consent', { version: '1' }).expect(200);
    await read().expect(200);
    await api('post', admin, `/admin/health/professionals/${pro.id}/review`, { decision: 'suspend', note: 'Plainte' }).expect(204);
    await read().expect(404); // a suspended professional loses every access
    expect((await api('get', pro, '/me/health/professional/patients').expect(200)).body.items).toEqual([]);
  });
});

describe('e-prescriptions (lot 18b)', () => {
  it('are off until the regulated flag is on; then only the professional of a completed appointment can issue one, once', async () => {
    const { pro } = await approvedPro();
    const patient = await consenting();
    const a = (await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: future() }).expect(201)).body;
    await api('post', pro, `/health/appointments/${a.id}/confirm`).expect(200);
    await startedAgo(a.id);
    await api('post', pro, `/health/appointments/${a.id}/complete`).expect(200);
    const issue = (u: TU, extra: Record<string, unknown> = {}) =>
      api('post', u, `/me/health/professional/appointments/${a.id}/prescription`, { items: [{ name: 'Amoxicilline', dose: '500 mg', instructions: '3 fois par jour' }], validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), ...extra });

    expect((await issue(pro).expect(403)).body.error.code).toBe('feature_disabled');
    await setFlag('health.prescriptions', true);
    try {
      await issue(pro, { items: [] }).expect(400);
      await issue(pro, { validUntil: '2020-01-01' }).expect(400);
      await issue(pro, { validUntil: '2099-01-01' }).expect(400);
      await issue(patient).expect(404); // the patient is not the professional of this appointment
      const rx = (await issue(pro).expect(201)).body;
      expect(rx.code).toMatch(/^[A-Z0-9]{12}$/);
      expect(rx.items).toEqual([{ name: 'Amoxicilline', dose: '500 mg', instructions: '3 fois par jour' }]);
      expect((await issue(pro).expect(409)).body.error.details.reason).toBe('already_issued');

      const raw = (await ctx.sql.query('SELECT items_enc FROM health_prescriptions WHERE id = $1', [rx.id])).rows[0].items_enc as string;
      expect(raw).not.toContain('Amoxicilline');
      const mine = (await api('get', patient, '/me/health/prescriptions').expect(200)).body.items;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ code: rx.code, professional: { id: pro.id } });
      expect((await api('get', patient, '/me/health/appointments')).body.items[0].hasPrescription).toBe(true);
      const other = await consenting();
      expect((await api('get', other, '/me/health/prescriptions').expect(200)).body.items).toEqual([]);
    } finally {
      await setFlag('health.prescriptions', false);
    }
  });

  it('refuses a prescription before the appointment is completed', async () => {
    const { pro } = await approvedPro();
    const patient = await consenting();
    const a = (await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: future() }).expect(201)).body;
    await setFlag('health.prescriptions', true);
    try {
      const res = await api('post', pro, `/me/health/professional/appointments/${a.id}/prescription`, { items: [{ name: 'X' }], validUntil: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
      expect(res.status).toBe(409);
      expect(res.body.error.details.reason).toBe('appointment_not_completed');
    } finally {
      await setFlag('health.prescriptions', false);
    }
  });
});

describe('availability and agenda (lot 18c)', () => {
  const allDays = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, start: '08:00', end: '10:00' }));
  const setAv = (pro: TU, body: Record<string, unknown>) => api('put', pro, '/me/health/professional/availability', { slotMinutes: 30, utcOffsetMinutes: 0, windows: allDays, ...body });

  it('validates the windows and needs a verified professional', async () => {
    const { pro } = await approvedPro();
    for (const bad of [
      { windows: [{ day: 1, start: '10:00', end: '09:00' }] },
      { windows: [{ day: 8, start: '08:00', end: '09:00' }] },
      { windows: [{ day: 1, start: '8:00', end: '09:00' }] },
      { slotMinutes: 25 },
      { windows: [1, 2, 3, 4, 5].map((h) => ({ day: 1, start: `0${h}:00`, end: `0${h}:30` })) },
      { windows: [{ day: 1, start: '08:00', end: '10:00' }, { day: 1, start: '09:00', end: '11:00' }] },
    ]) expect((await setAv(pro, bad)).status).toBe(400);
    expect((await setAv(await user(), {})).status).toBe(404); // not a verified professional
    const ok = (await setAv(pro, {}).expect(200)).body;
    expect(ok.availability).toMatchObject({ slotMinutes: 30, utcOffsetMinutes: 0 });
    expect((await api('get', pro, '/me/health/professional/availability').expect(200)).body.availability.windows).toHaveLength(7);
  });

  it('lists free slots for 14 days, minus taken ones, and refuses a booking outside them', async () => {
    const { pro } = await approvedPro();
    const patient = await consenting();
    expect((await api('get', patient, `/health-professionals/${pro.id}/slots`).expect(200)).body).toEqual({ slotMinutes: null, items: [] });
    await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: future(2) }).expect(201); // no availability: unchanged

    await setAv(pro, {}).expect(200);
    const slots = (await api('get', patient, `/health-professionals/${pro.id}/slots`).expect(200)).body;
    expect(slots.slotMinutes).toBe(30);
    const times: string[] = slots.items.map((i: { startsAt: string }) => i.startsAt);
    expect(times.length).toBeGreaterThanOrEqual(14 * 4 - 4);
    expect(times.length).toBeLessThanOrEqual(15 * 4);
    expect([...times].sort()).toEqual(times);
    expect(times.every((t) => Date.parse(t) > Date.now() && Date.parse(t) <= Date.now() + 14 * 86_400_000 && /T0[89]:[03]0:00/.test(t))).toBe(true);

    const refused = await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: future(3) });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('slot_unavailable');
    const pick = times[5]!;
    await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: pick }).expect(201);
    const after = (await api('get', patient, `/health-professionals/${pro.id}/slots`).expect(200)).body.items.map((i: { startsAt: string }) => i.startsAt);
    expect(after).not.toContain(pick);
    expect((await api('post', await consenting(), '/me/health/appointments', { professionalId: pro.id, startsAt: pick })).status).toBe(409);

    // the professional's clock: +180 minutes moves the slots 3 hours earlier in UTC
    await setAv(pro, { utcOffsetMinutes: 180 }).expect(200);
    const shifted = (await api('get', patient, `/health-professionals/${pro.id}/slots`).expect(200)).body.items;
    expect(shifted.every((i: { startsAt: string }) => /T0[5-6]:[03]0:00/.test(i.startsAt))).toBe(true);

    await setAv(pro, { windows: [] }).expect(200); // removed: free choice again
    await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: future(4) }).expect(201);
  });

  it('shows the professional their upcoming agenda, soonest first, without the past or cancelled', async () => {
    const { pro } = await approvedPro();
    const patient = await consenting();
    const [late, soon, gone] = [future(6), future(2), future(4)];
    await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: late }).expect(201);
    await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: soon }).expect(201);
    const c = (await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: gone }).expect(201)).body;
    await api('post', patient, `/health/appointments/${c.id}/cancel`).expect(200);
    const agenda = (await api('get', pro, '/me/health/professional/agenda').expect(200)).body.items;
    expect(agenda.map((a: { startsAt: string }) => a.startsAt)).toEqual([soon, late]);
    await setAv(pro, {}).expect(200);
    const audits = await ctx.sql.query(`SELECT metadata::text AS md FROM audit_events WHERE action = 'health.availability_updated' AND subject_user_id = $1`, [pro.id]);
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows)).not.toContain('08:00');
    expect((await api('get', pro, '/me/export').expect(200)).body.health).toHaveProperty('availability');
  });
});

describe('audit, export, erasure (lot 18b)', () => {
  it('audits without any content, exports the patient\'s decrypted data, and erases it with the rest', async () => {
    const { pro } = await approvedPro();
    const patient = await consenting();
    await api('post', patient, '/me/health/entries', entry()).expect(201);
    const a = (await api('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: future(), reason: 'Douleur au dos secrète' }).expect(201)).body;
    await api('post', patient, '/me/health/shares', { professionalId: pro.id, kinds: ['allergy'] }).expect(201);
    await api('get', pro, `/me/health/professional/patients/${patient.id}/record`).expect(200);

    const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE action LIKE 'health.%' AND subject_user_id IN ($1, $2)`, [patient.id, pro.id]);
    const actions = audits.rows.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['health.professional_applied', 'health.appointment_requested', 'health.share_granted', 'health.record_read']));
    for (const word of ['secrète', 'Pénicilline', 'CNOM', 'Douleur']) expect(JSON.stringify(audits.rows)).not.toContain(word);

    const exp = (await api('get', patient, '/me/export').expect(200)).body.health;
    expect(exp.appointments).toHaveLength(1);
    expect(exp.appointments[0]).toMatchObject({ status: 'requested', reason: 'Douleur au dos secrète' });
    const proExp = (await api('get', pro, '/me/export').expect(200)).body.health;
    expect(proExp.professional).toMatchObject({ status: 'approved', licenseNumber: 'CNOM-12345' });
    expect(proExp.appointments).toEqual([]); // as a professional it is not their own health data

    await api('delete', patient, '/me/health/data').expect(204);
    const left = await ctx.sql.query(
      `SELECT (SELECT count(*) FROM health_appointments WHERE patient_id = $1)::int AS a, (SELECT count(*) FROM health_shares WHERE patient_id = $1)::int AS s, (SELECT count(*) FROM health_access_log WHERE patient_id = $1)::int AS l`,
      [patient.id],
    );
    expect(left.rows[0]).toEqual({ a: 0, s: 0, l: 0 });
    expect((await api('get', pro, '/me/health/professional/appointments').expect(200)).body.items.find((x: { id: string }) => x.id === a.id)).toBeUndefined();
  });

  it('is off with the flag, for professionals and admins too', async () => {
    const u = await user();
    await setFlag('health', false);
    try {
      expect((await api('get', u, '/health-professionals')).status).toBe(403);
      expect((await api('get', u, '/me/health/professional')).status).toBe(403);
    } finally {
      await setFlag('health', true);
    }
  });
});
