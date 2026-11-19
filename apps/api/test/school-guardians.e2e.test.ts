import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { FeesService } from '../src/school/fees.service.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'school'`);
});
afterAll(async () => {
  await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'school'`);
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
let n = 0;
async function school(owner: TU): Promise<string> {
  n += 1;
  return (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `parents-${Date.now().toString(36)}-${n}`, name: 'Ecole Parents', kind: 'school' }).expect(201)).body.id;
}
const call = (method: 'get' | 'post' | 'delete', u: TU, path: string, body?: Record<string, unknown>) => ctx.http[method](`/v1${path}`).set(bearer(u.token)).send(body ?? {});
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const reminders = async (u: TU) => (await call('get', u, '/notifications').expect(200)).body.items.filter((x: { title: string }) => x.title === 'Frais scolaires');

describe('parent-pupil links, fee reminders and export (lot 17b leftovers)', () => {
  it('staff link, parent accepts, parent reads the child (classes + fee status) and nothing else', async () => {
    const [head, pupil, other, mum, stranger] = [await user(), await user(), await user(), await user(), await user()];
    const org = await school(head);
    const cls = (await call('post', head, `/orgs/${org}/school/classes`, { name: '6e A', yearLabel: '2026-2027' }).expect(201)).body;
    const base = `/orgs/${org}/school/classes/${cls.id}`;
    for (const u of [pupil, other]) await call('post', head, `${base}/members`, { handle: u.handle, role: 'student' }).expect(204);
    await call('post', head, `${base}/lessons`, { weekday: 1, startsAt: '08:00', endsAt: '09:00', subject: 'Maths', room: 'B2' }).expect(201);
    await call('post', head, `${base}/announcements`, { title: 'Reunion', body: 'Vendredi' }).expect(201);
    const fee = (await call('post', head, `${base}/fees`, { title: 'Minerval T1', amountMinor: 5000, currency: 'USD', dueOn: day(30) }).expect(201)).body;
    await call('post', head, `${base}/fees/${fee.id}/mark`, { handle: other.handle, paid: true }).expect(204);

    // Staff only; the pupil must be enrolled in THIS school; unknown handle, same person, duplicate.
    const link = { studentHandle: pupil.handle, guardianHandle: mum.handle, relation: 'Mere' };
    await call('post', stranger, `/orgs/${org}/school/guardians`, link).expect(404);
    await call('post', pupil, `/orgs/${org}/school/guardians`, link).expect(404);
    await call('post', head, `/orgs/${org}/school/guardians`, { ...link, studentHandle: stranger.handle }).expect(404); // not enrolled
    await call('post', head, `/orgs/${org}/school/guardians`, { ...link, guardianHandle: 'nobody_here_zz' }).expect(404);
    await call('post', head, `/orgs/${org}/school/guardians`, { ...link, guardianHandle: pupil.handle }).expect(409);
    const created = (await call('post', head, `/orgs/${org}/school/guardians`, link).expect(201)).body;
    expect(created).toMatchObject({ studentHandle: pupil.handle, guardianHandle: mum.handle, relation: 'Mere', status: 'pending' });
    await call('post', head, `/orgs/${org}/school/guardians`, link).expect(409);

    // Generic invitation, nobody named; pending opens nothing.
    const invite = (await call('get', mum, '/notifications').expect(200)).body.items.filter((x: { data?: { guardianshipId?: string } }) => x.data?.guardianshipId === created.id);
    expect(invite).toHaveLength(1);
    expect(JSON.stringify(invite)).not.toContain(pupil.handle);
    expect((await call('get', mum, '/me/school/guardianships').expect(200)).body.items).toEqual([expect.objectContaining({ id: created.id, status: 'pending', schoolName: 'Ecole Parents' })]);
    expect((await call('get', mum, '/me/school/children').expect(200)).body.items).toEqual([]);
    await call('get', mum, `/me/school/children/${pupil.id}/fees`).expect(404);
    await call('get', mum, `/me/school/children/${pupil.id}/classes`).expect(404);

    // Only the invited parent answers.
    await call('post', stranger, `/me/school/guardianships/${created.id}/accept`).expect(404);
    await call('post', head, `/me/school/guardianships/${created.id}/accept`).expect(404);
    await call('post', mum, `/me/school/guardianships/${created.id}/accept`).expect(204);
    await call('post', mum, `/me/school/guardianships/${created.id}/accept`).expect(204); // idempotent
    expect((await call('get', head, `/orgs/${org}/school/guardians`).expect(200)).body.items[0].status).toBe('active');

    const kids = (await call('get', mum, '/me/school/children').expect(200)).body.items;
    expect(kids).toEqual([expect.objectContaining({ studentId: pupil.id, schoolName: 'Ecole Parents', relation: 'Mere' })]);
    const fees = (await call('get', mum, `/me/school/children/${pupil.id}/fees`).expect(200)).body.items;
    expect(fees).toEqual([expect.objectContaining({ title: 'Minerval T1', paid: false })]);
    const classes = (await call('get', mum, `/me/school/children/${pupil.id}/classes`).expect(200)).body.items;
    expect(classes).toHaveLength(1);
    expect(classes[0].class.name).toBe('6e A');
    expect(classes[0].lessons[0].subject).toBe('Maths');
    expect(classes[0].announcements[0].title).toBe('Reunion');

    // The parent sees nothing of another pupil of the same class, nor through anyone else's id.
    await call('get', mum, `/me/school/children/${other.id}/fees`).expect(404);
    await call('get', mum, `/me/school/children/${other.id}/classes`).expect(404);
    await call('get', mum, '/me/school/children/not-a-uuid/fees').expect(404);
    await call('get', stranger, `/me/school/children/${pupil.id}/fees`).expect(404);
    await call('post', head, `${base}/fees/${fee.id}/mark`, { handle: pupil.handle, paid: true }).expect(204);
    expect((await call('get', mum, `/me/school/children/${pupil.id}/fees`).expect(200)).body.items[0].paid).toBe(true);

    // Export: ids and relation on both sides, fee titles and status without any other pupil.
    const mumExport = (await call('get', mum, '/me/export').expect(200)).body;
    expect(mumExport.schoolGuardians).toEqual([{ id: created.id, role: 'guardian', otherUserId: pupil.id, relation: 'Mere', status: 'active' }]);
    expect(mumExport.schoolFees).toEqual([]);
    const pupilExport = (await call('get', pupil, '/me/export').expect(200)).body;
    expect(pupilExport.schoolGuardians).toEqual([{ id: created.id, role: 'student', otherUserId: mum.id, relation: 'Mere', status: 'active' }]);
    expect(pupilExport.schoolFees).toEqual([{ title: 'Minerval T1', dueOn: day(30), paid: true }]);
    expect(JSON.stringify(pupilExport.schoolFees)).not.toMatch(/5000|amount/);

    // Audit holds ids only.
    const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE action LIKE 'school.guardian_%'`);
    expect(audits.rows.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['school.guardian_invited', 'school.guardian_accepted']));
    const md = audits.rows.map((r: { md: string }) => r.md).join('');
    expect(md).not.toContain(pupil.handle);
    expect(md).not.toContain('Mere');

    // Staff remove the link: access ends at once.
    await call('delete', stranger, `/orgs/${org}/school/guardians/${created.id}`).expect(404);
    await call('delete', head, `/orgs/${org}/school/guardians/${created.id}`).expect(204);
    await call('delete', head, `/orgs/${org}/school/guardians/${created.id}`).expect(404);
    await call('get', mum, `/me/school/children/${pupil.id}/fees`).expect(404);
  });

  it('a parent can decline (and the school may invite again) or end an active link', async () => {
    const [head, pupil, dad] = [await user(), await user(), await user()];
    const org = await school(head);
    const cls = (await call('post', head, `/orgs/${org}/school/classes`, { name: '4e C', yearLabel: '2026-2027' }).expect(201)).body;
    await call('post', head, `/orgs/${org}/school/classes/${cls.id}/members`, { handle: pupil.handle, role: 'student' }).expect(204);
    const link = { studentHandle: pupil.handle, guardianHandle: dad.handle };
    const first = (await call('post', head, `/orgs/${org}/school/guardians`, link).expect(201)).body;
    await call('post', dad, `/me/school/guardianships/${first.id}/decline`).expect(204);
    await call('post', dad, `/me/school/guardianships/${first.id}/decline`).expect(404);
    expect((await call('get', head, `/orgs/${org}/school/guardians`).expect(200)).body.items).toEqual([]);
    const second = (await call('post', head, `/orgs/${org}/school/guardians`, link).expect(201)).body;
    await call('post', dad, `/me/school/guardianships/${second.id}/accept`).expect(204);
    await call('post', dad, `/me/school/guardianships/${second.id}/decline`).expect(204);
    await call('get', dad, `/me/school/children/${pupil.id}/classes`).expect(404);
    const audits = await ctx.sql.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'school.guardian_declined'`);
    expect(audits.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('the pupil sees the links that concern them and can end them; the parent is told generically', async () => {
    const [head, pupil, mum, other] = [await user(), await user(), await user(), await user()];
    const org = await school(head);
    const cls = (await call('post', head, `/orgs/${org}/school/classes`, { name: '2e B', yearLabel: '2026-2027' }).expect(201)).body;
    await call('post', head, `/orgs/${org}/school/classes/${cls.id}/members`, { handle: pupil.handle, role: 'student' }).expect(204);
    const link = (await call('post', head, `/orgs/${org}/school/guardians`, { studentHandle: pupil.handle, guardianHandle: mum.handle, relation: 'Mere' }).expect(201)).body;
    await call('post', mum, `/me/school/guardianships/${link.id}/accept`).expect(204);

    const seen = (await call('get', pupil, '/me/school/guardians').expect(200)).body.items;
    expect(seen).toEqual([{ id: link.id, schoolName: 'Ecole Parents', guardianDisplayName: 'Test User', relation: 'Mere', status: 'active' }]);
    expect((await call('get', other, '/me/school/guardians').expect(200)).body.items).toEqual([]);

    await call('delete', other, `/me/school/guardians/${link.id}`).expect(404); // not theirs
    await call('delete', mum, `/me/school/guardians/${link.id}`).expect(404); // the parent uses the decline route
    await call('delete', pupil, '/me/school/guardians/not-a-uuid').expect(404);
    await call('delete', pupil, `/me/school/guardians/${link.id}`).expect(204);
    await call('delete', pupil, `/me/school/guardians/${link.id}`).expect(404);
    expect((await call('get', pupil, '/me/school/guardians').expect(200)).body.items).toEqual([]);
    expect((await call('get', head, `/orgs/${org}/school/guardians`).expect(200)).body.items).toEqual([]);
    await call('get', mum, `/me/school/children/${pupil.id}/classes`).expect(404); // access is gone

    const note = (await call('get', mum, '/notifications').expect(200)).body.items.filter((x: { title: string }) => x.title === 'Suivi scolaire');
    expect(note).toHaveLength(1);
    expect(JSON.stringify(note)).not.toContain(pupil.handle);
    const audit = await ctx.sql.query(`SELECT metadata::text AS md FROM audit_events WHERE action = 'school.guardian_removed_by_student' AND actor_user_id = $1`, [pupil.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].md).not.toContain('Test User');
  });

  it('the regulated school flag cuts everything', async () => {
    const [head, mum] = [await user(), await user()];
    const org = await school(head);
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'school'`);
    try {
      await call('get', head, `/orgs/${org}/school/guardians`).expect(403);
      await call('get', mum, '/me/school/guardianships').expect(403);
      await call('get', mum, '/me/school/children').expect(403);
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'school'`);
    }
  });

  it('due-date reminder: once per fee, unpaid pupils and active parents only, generic text', async () => {
    const [head, late, paid, mum, pending] = [await user(), await user(), await user(), await user(), await user()];
    const org = await school(head);
    const cls = (await call('post', head, `/orgs/${org}/school/classes`, { name: '3e D', yearLabel: '2026-2027' }).expect(201)).body;
    const base = `/orgs/${org}/school/classes/${cls.id}`;
    for (const u of [late, paid]) await call('post', head, `${base}/members`, { handle: u.handle, role: 'student' }).expect(204);
    // mum follows `late` (active); `pending` was invited for `paid` but never accepted.
    const l1 = (await call('post', head, `/orgs/${org}/school/guardians`, { studentHandle: late.handle, guardianHandle: mum.handle }).expect(201)).body;
    await call('post', mum, `/me/school/guardianships/${l1.id}/accept`).expect(204);
    await call('post', head, `/orgs/${org}/school/guardians`, { studentHandle: paid.handle, guardianHandle: pending.handle }).expect(201);

    const soon = (await call('post', head, `${base}/fees`, { title: 'Minerval T2', amountMinor: 7000, currency: 'USD', dueOn: day(2) }).expect(201)).body;
    await call('post', head, `${base}/fees`, { title: 'Lointain', amountMinor: 100, currency: 'USD', dueOn: day(20) }).expect(201);
    await call('post', head, `${base}/fees/${soon.id}/mark`, { handle: paid.handle, paid: true }).expect(204);

    // Direct call, then the whole maintenance run and another call: the fee was claimed once, so nobody is notified twice.
    expect(await ctx.app.get(FeesService).remindDue(new Date())).toBe(2); // `late` and `mum`
    await ctx.app.get(MaintenanceService).runOnce();
    expect(await ctx.app.get(FeesService).remindDue(new Date())).toBe(0);
    expect(await reminders(late)).toHaveLength(1);
    expect(await reminders(mum)).toHaveLength(1);
    expect(await reminders(paid)).toHaveLength(0);
    expect(await reminders(pending)).toHaveLength(0);
    expect(await reminders(head)).toHaveLength(0);
    expect(JSON.stringify(await reminders(late))).not.toMatch(/7000|Minerval/);
    const rows = await ctx.sql.query(`SELECT title, reminded_at IS NOT NULL AS done FROM school_fees WHERE class_id = $1 ORDER BY title`, [cls.id]);
    expect(rows.rows).toEqual([{ title: 'Lointain', done: false }, { title: 'Minerval T2', done: true }]);
  });

  it('the reminder is marked done only after the send: a failed send is retried, and two runs at once notify once', async () => {
    const [head, pupil, dad] = [await user(), await user(), await user()];
    const org = await school(head);
    const cls = (await call('post', head, `/orgs/${org}/school/classes`, { name: '5e E', yearLabel: '2026-2027' }).expect(201)).body;
    const base = `/orgs/${org}/school/classes/${cls.id}`;
    await call('post', head, `${base}/members`, { handle: pupil.handle, role: 'student' }).expect(204);
    const l = (await call('post', head, `/orgs/${org}/school/guardians`, { studentHandle: pupil.handle, guardianHandle: dad.handle }).expect(201)).body;
    await call('post', dad, `/me/school/guardianships/${l.id}/accept`).expect(204);
    await call('post', head, `${base}/fees`, { title: 'Minerval T3', amountMinor: 900, currency: 'USD', dueOn: day(1) }).expect(201);
    const fees = ctx.app.get(FeesService);
    const reminded = async () => (await ctx.sql.query('SELECT reminded_at IS NOT NULL AS done FROM school_fees WHERE class_id = $1', [cls.id])).rows[0].done as boolean;

    const spy = vi.spyOn(ctx.app.get(NotificationsService), 'notifyMany').mockRejectedValueOnce(new Error('push down'));
    await expect(fees.remindDue(new Date())).rejects.toThrow('push down');
    spy.mockRestore();
    expect(await reminded()).toBe(false);
    expect(await reminders(pupil)).toHaveLength(0);

    const [a, b] = await Promise.all([fees.remindDue(new Date()), fees.remindDue(new Date())]);
    expect(a + b).toBe(2); // pupil + parent, once
    expect(await reminded()).toBe(true);
    expect(await reminders(pupil)).toHaveLength(1);
    expect(await reminders(dad)).toHaveLength(1);
  });

  it('the reminder does nothing while the school flag is off', async () => {
    const [head, pupil] = [await user(), await user()];
    const org = await school(head);
    const cls = (await call('post', head, `/orgs/${org}/school/classes`, { name: '2e E', yearLabel: '2026-2027' }).expect(201)).body;
    await call('post', head, `/orgs/${org}/school/classes/${cls.id}/members`, { handle: pupil.handle, role: 'student' }).expect(204);
    await call('post', head, `/orgs/${org}/school/classes/${cls.id}/fees`, { title: 'Frais', amountMinor: 100, currency: 'CDF', dueOn: day(1) }).expect(201);
    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'school'`);
    try {
      expect(await ctx.app.get(FeesService).remindDue(new Date())).toBe(0);
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'school'`);
    }
    expect(await reminders(pupil)).toHaveLength(0);
    expect(await ctx.app.get(FeesService).remindDue(new Date())).toBe(1);
  });
});
