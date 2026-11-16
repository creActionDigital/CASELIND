import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
const setFlag = (enabled: boolean) => ctx.sql.query(`UPDATE feature_flags SET enabled = $1 WHERE key = 'school'`, [enabled]);

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
async function org(owner: TU, kind: string): Promise<string> {
  n += 1;
  return (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `ecole-${Date.now().toString(36)}-${n}`, name: 'Ecole Test', kind }).expect(201)).body.id;
}
const call = (method: 'get' | 'post' | 'delete', u: TU, path: string, body?: Record<string, unknown>) => ctx.http[method](`/v1${path}`).set(bearer(u.token)).send(body ?? {});

describe('schools (lot 17b)', () => {
  it('is a regulated flag, off by default', async () => {
    expect((await ctx.sql.query(`SELECT enabled, regulated FROM feature_flags WHERE key = 'school'`)).rows[0]).toEqual({ enabled: false, regulated: true });
    const u = await user();
    expect((await call('get', u, '/me/school/classes')).body.error.code).toBe('feature_disabled');
  });

  describe('with the module on', () => {
    beforeAll(() => setFlag(true));
    afterAll(() => setFlag(false));

    it('only a school, only its staff; classes, enrolment, timetable and announcements', async () => {
      const [head, pupil, outsider] = [await user(), await user(), await user()];
      const shop = await org(head, 'shop');
      const school = await org(head, 'school');
      await call('post', head, `/orgs/${shop}/school/classes`, { name: '6e A' }).expect(409); // not a school
      await call('post', outsider, `/orgs/${school}/school/classes`, { name: '6e A' }).expect(404); // not a member

      const cls = (await call('post', head, `/orgs/${school}/school/classes`, { name: '6e A', yearLabel: '2026-2027' }).expect(201)).body;
      expect(cls).toMatchObject({ name: '6e A', memberCount: 0 });
      await call('post', head, `/orgs/${school}/school/classes`, { name: '6e A', yearLabel: '2026-2027' }).expect(409);
      await call('post', head, `/orgs/${school}/school/classes/${cls.id}/members`, { handle: 'nobody-here-xyz', role: 'student' }).expect(404);
      await call('post', head, `/orgs/${school}/school/classes/${cls.id}/members`, { handle: pupil.handle, role: 'witch' }).expect(400);
      await call('post', head, `/orgs/${school}/school/classes/${cls.id}/members`, { handle: pupil.handle, role: 'student' }).expect(204);
      await call('post', head, `/orgs/${school}/school/classes/${cls.id}/members`, { handle: pupil.handle, role: 'parent' }).expect(204); // role updated, not duplicated
      expect((await call('get', head, `/orgs/${school}/school/classes/${cls.id}/members`).expect(200)).body.items).toEqual([expect.objectContaining({ handle: pupil.handle, role: 'parent' })]);
      expect((await call('get', head, `/orgs/${school}/school/classes`).expect(200)).body.items[0].memberCount).toBe(1);

      await call('post', head, `/orgs/${school}/school/classes/${cls.id}/lessons`, { weekday: 8, startsAt: '08:00', endsAt: '09:00', subject: 'Maths' }).expect(400);
      await call('post', head, `/orgs/${school}/school/classes/${cls.id}/lessons`, { weekday: 1, startsAt: '09:00', endsAt: '08:00', subject: 'Maths' }).expect(400);
      const l2 = (await call('post', head, `/orgs/${school}/school/classes/${cls.id}/lessons`, { weekday: 2, startsAt: '10:00', endsAt: '11:00', subject: 'Français', room: 'B2' }).expect(201)).body;
      await call('post', head, `/orgs/${school}/school/classes/${cls.id}/lessons`, { weekday: 1, startsAt: '08:00', endsAt: '09:00', subject: 'Maths' }).expect(201);
      await call('post', head, `/orgs/${school}/school/classes/${cls.id}/announcements`, { title: 'Réunion', body: 'Vendredi 17h' }).expect(201);

      const mine = (await call('get', pupil, '/me/school/classes').expect(200)).body.items;
      expect(mine).toEqual([expect.objectContaining({ id: cls.id, name: '6e A', schoolName: 'Ecole Test', role: 'parent' })]);
      const detail = (await call('get', pupil, `/me/school/classes/${cls.id}`).expect(200)).body;
      expect(detail.lessons.map((l: { subject: string }) => l.subject)).toEqual(['Maths', 'Français']); // by weekday
      expect(detail.announcements[0]).toMatchObject({ title: 'Réunion' });
      await call('get', outsider, `/me/school/classes/${cls.id}`).expect(404); // not enrolled
      await call('get', pupil, `/orgs/${school}/school/classes`).expect(404); // the enrolled are not staff
      await call('post', pupil, `/orgs/${school}/school/classes/${cls.id}/announcements`, { title: 'x', body: 'y' }).expect(404);

      await call('delete', head, `/orgs/${school}/school/classes/${cls.id}/lessons/${l2.id}`).expect(204);
      await call('delete', head, `/orgs/${school}/school/classes/${cls.id}/lessons/${l2.id}`).expect(404);

      const exported = (await call('get', pupil, '/me/export').expect(200)).body;
      expect(exported.school).toEqual([{ schoolName: 'Ecole Test', className: '6e A', role: 'parent' }]);
      const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE action LIKE 'school.%'`);
      expect(audits.rows.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['school.class_created', 'school.enrolled', 'school.announced']));
      const all = audits.rows.map((r: { md: string }) => r.md).join('');
      expect(all).not.toContain('Réunion');
      expect(all).not.toContain('Vendredi');

      await call('delete', outsider, `/me/school/classes/${cls.id}`).expect(404); // not enrolled
      await call('delete', pupil, `/me/school/classes/${cls.id}`).expect(204); // leaving is always possible
      await call('get', pupil, `/me/school/classes/${cls.id}`).expect(404);
      await call('delete', head, `/orgs/${school}/school/classes/${cls.id}/members/${pupil.handle}`).expect(404); // already gone
    });

    describe('announcement notifications (lot 17c)', () => {
      it('notifies the enrolled, not the author, without the text; the departed get nothing', async () => {
        const [head, pupil, gone] = [await user(), await user(), await user()];
        const school = await org(head, 'school');
        const cls = (await call('post', head, `/orgs/${school}/school/classes`, { name: '5e B', yearLabel: '2026-2027' }).expect(201)).body;
        for (const u of [pupil, gone]) await call('post', head, `/orgs/${school}/school/classes/${cls.id}/members`, { handle: u.handle, role: 'student' }).expect(204);
        await call('delete', gone, `/me/school/classes/${cls.id}`).expect(204);
        await call('post', head, `/orgs/${school}/school/classes/${cls.id}/announcements`, { title: 'Sortie secrete', body: 'Zoo mardi' }).expect(201);
        const notes = async (u: TU) => (await call('get', u, '/notifications').expect(200)).body.items.filter((x: { data?: { classId?: string } }) => x.data?.classId === cls.id);
        const got = await notes(pupil);
        expect(got).toHaveLength(1);
        expect(JSON.stringify(got)).not.toMatch(/secrete|Zoo/);
        expect(got[0].body).toContain('5e B');
        expect(await notes(head)).toHaveLength(0);
        expect(await notes(gone)).toHaveLength(0);
      });
    });
  });
});
