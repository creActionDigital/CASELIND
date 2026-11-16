import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  return (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `frais-${Date.now().toString(36)}-${n}`, name: 'Ecole Frais', kind: 'school' }).expect(201)).body.id;
}
const call = (method: 'get' | 'post', u: TU, path: string, body?: Record<string, unknown>) => ctx.http[method](`/v1${path}`).set(bearer(u.token)).send(body ?? {});

describe('school fee statements (lot 17h)', () => {
  it('a record only: staff state a fee and mark students, enrolled people read theirs', async () => {
    const [head, pupil, parent, outsider, other] = [await user(), await user(), await user(), await user(), await user()];
    const org = await school(head);
    const cls = (await call('post', head, `/orgs/${org}/school/classes`, { name: '6e A', yearLabel: '2026-2027' }).expect(201)).body;
    const base = `/orgs/${org}/school/classes/${cls.id}`;
    await call('post', head, `${base}/members`, { handle: pupil.handle, role: 'student' }).expect(204);
    await call('post', head, `${base}/members`, { handle: parent.handle, role: 'parent' }).expect(204);

    await call('post', outsider, `${base}/fees`, { title: 'Minerval', amountMinor: 5000, currency: 'USD' }).expect(404); // not staff
    await call('post', head, `${base}/fees`, { title: 'Minerval', amountMinor: 0, currency: 'USD' }).expect(400);
    await call('post', head, `${base}/fees`, { title: 'Minerval', amountMinor: 5000, currency: 'EUR' }).expect(400);
    await call('post', head, `${base}/fees`, { title: 'Minerval', amountMinor: 5000, currency: 'USD', dueOn: '2026-13-45' }).expect(400);
    const fee = (await call('post', head, `${base}/fees`, { title: 'Minerval T1', amountMinor: 5000, currency: 'USD', dueOn: '2027-01-31' }).expect(201)).body;
    expect(fee).toMatchObject({ title: 'Minerval T1', amountMinor: 5000, paidCount: 0, studentCount: 1 });

    // Statuses: only students of the class can be marked; another class or a parent is a 404.
    await call('post', head, `${base}/fees/${fee.id}/mark`, { handle: parent.handle, paid: true }).expect(404);
    await call('post', head, `${base}/fees/${fee.id}/mark`, { handle: outsider.handle, paid: true }).expect(404);
    await call('post', head, `${base}/fees/00000000-0000-4000-8000-000000000000/mark`, { handle: pupil.handle, paid: true }).expect(404);
    expect((await call('get', head, `${base}/fees/${fee.id}/statuses`).expect(200)).body.items).toEqual([expect.objectContaining({ handle: pupil.handle, paid: false })]);
    expect((await call('get', head, `${base}/fees`).expect(200)).body.items[0]).toMatchObject({ paidCount: 0, studentCount: 1 });

    const mine = async (u: TU) => (await call('get', u, '/me/school/fees').expect(200)).body.items;
    expect(await mine(pupil)).toEqual([expect.objectContaining({ title: 'Minerval T1', amountMinor: 5000, dueOn: '2027-01-31', paid: false, schoolName: 'Ecole Frais' })]);
    await call('post', head, `${base}/fees/${fee.id}/mark`, { handle: pupil.handle, paid: true }).expect(204);
    await call('post', head, `${base}/fees/${fee.id}/mark`, { handle: pupil.handle, paid: true }).expect(204); // idempotent
    expect((await mine(pupil))[0].paid).toBe(true);
    expect((await call('get', head, `${base}/fees`).expect(200)).body.items[0]).toMatchObject({ paidCount: 1, studentCount: 1 });
    expect((await mine(parent))[0].paid).toBeNull(); // a parent sees the fee, not a pupil's status
    expect(await mine(outsider)).toEqual([]);

    // Staff only on the staff routes (the enrolled are not staff), and another school's staff cannot touch this class.
    await call('get', pupil, `${base}/fees`).expect(404);
    const otherOrg = await school(other);
    await call('get', other, `/orgs/${otherOrg}/school/classes/${cls.id}/fees`).expect(404); // class of another school

    await call('post', head, `${base}/fees/${fee.id}/mark`, { handle: pupil.handle, paid: false }).expect(204);
    expect((await mine(pupil))[0].paid).toBe(false);

    // The audit holds ids and the flag, never names, titles or amounts.
    const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE action LIKE 'school.fee_%'`);
    expect(audits.rows.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['school.fee_created', 'school.fee_marked']));
    const all = audits.rows.map((r: { md: string }) => r.md).join('');
    expect(all).not.toContain('Minerval');
    expect(all).not.toContain('5000');
  });
});
