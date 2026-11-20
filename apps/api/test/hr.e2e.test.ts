import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
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

let n = 0;
async function createOrg(owner: TU): Promise<string> {
  const slug = `hr-${Date.now().toString(36)}-${++n}`;
  return (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: 'Entreprise RH', kind: 'shop' }).expect(201)).body.id;
}

async function addMember(orgId: string, owner: TU, m: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(owner.token)).send({ handle: m.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(m.token)).expect(200);
}

const DAY = 86_400_000;
const date = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const YEAR = new Date().getUTCFullYear();

interface Team {
  orgId: string;
  owner: TU;
  hr: TU;
  manager: TU;
  fin: TU;
  emp: TU;
  emp2: TU;
  stranger: TU;
}
async function team(): Promise<Team> {
  const [owner, hr, manager, fin, emp, emp2, stranger] = [await user(), await user(), await user(), await user(), await user(), await user(), await user()];
  const orgId = await createOrg(owner);
  await addMember(orgId, owner, hr, 'hr');
  await addMember(orgId, owner, manager, 'manager');
  await addMember(orgId, owner, fin, 'finance');
  await addMember(orgId, owner, emp, 'employee');
  await addMember(orgId, owner, emp2, 'employee');
  await createOrg(stranger);
  return { orgId, owner, hr, manager, fin, emp, emp2, stranger };
}

const profile = (extra: Record<string, unknown> = {}) => ({ jobTitle: 'Vendeur', employmentType: 'full_time', startedOn: '2025-01-06', ...extra });
const put = (u: TU, orgId: string, userId: string, body: Record<string, unknown>) => ctx.http.put(`/v1/orgs/${orgId}/hr/employees/${userId}`).set(bearer(u.token)).send(body);
const askLeave = (u: TU, orgId: string, body: Record<string, unknown>) => ctx.http.post(`/v1/orgs/${orgId}/hr/leaves`).set(bearer(u.token)).send(body);
const decide = (u: TU, orgId: string, id: string, decision: 'approve' | 'reject') => ctx.http.post(`/v1/orgs/${orgId}/hr/leaves/${id}/decision`).set(bearer(u.token)).send({ decision });
const shift = (u: TU, orgId: string, body: Record<string, unknown>) => ctx.http.post(`/v1/orgs/${orgId}/hr/shifts`).set(bearer(u.token)).send(body);
const salary = (u: TU, orgId: string, body: Record<string, unknown>) => ctx.http.put(`/v1/orgs/${orgId}/hr/salary`).set(bearer(u.token)).send(body);

describe('employee profiles', () => {
  it('HR edits, the employee reads their own without the HR note, others are refused, isolation holds', async () => {
    const t = await team();
    const saved = (await put(t.hr, t.orgId, t.emp.id, profile({ department: 'Vente', annualLeaveDays: 20, note: 'NOTE-RH-SECRETE', managerUserId: t.manager.id })).expect(200)).body;
    expect(saved).toMatchObject({ userId: t.emp.id, role: 'employee', profile: { jobTitle: 'Vendeur', department: 'Vente', note: 'NOTE-RH-SECRETE', managerUserId: t.manager.id, annualLeaveDays: 20 } });

    const own = (await ctx.http.get(`/v1/orgs/${t.orgId}/hr/employees/${t.emp.id}`).set(bearer(t.emp.token)).expect(200)).body;
    expect(own.profile.note).toBeNull();
    expect(own.profile.jobTitle).toBe('Vendeur');
    expect((await ctx.http.get(`/v1/orgs/${t.orgId}/hr/employees/${t.emp.id}`).set(bearer(t.manager.token)).expect(200)).body.profile.note).toBeNull();
    expect((await ctx.http.get(`/v1/orgs/${t.orgId}/hr/employees/${t.emp.id}`).set(bearer(t.hr.token)).expect(200)).body.profile.note).toBe('NOTE-RH-SECRETE');
    await ctx.http.get(`/v1/orgs/${t.orgId}/hr/employees/${t.emp.id}`).set(bearer(t.emp2.token)).expect(403);

    await put(t.emp, t.orgId, t.emp.id, profile()).expect(403);
    await put(t.manager, t.orgId, t.emp.id, profile()).expect(403);
    await put(t.stranger, t.orgId, t.emp.id, profile()).expect(404);
    await put(t.hr, t.orgId, t.stranger.id, profile()).expect(404);
    await put(t.hr, t.orgId, t.emp.id, profile({ managerUserId: t.stranger.id })).expect(400);
    await put(t.hr, t.orgId, t.emp.id, profile({ managerUserId: t.emp.id })).expect(400);
    await put(t.hr, t.orgId, t.emp.id, profile({ endedOn: '2024-01-01' })).expect(400);
    await put(t.hr, t.orgId, t.emp.id, profile({ employmentType: 'slave' })).expect(400);
    await put(t.hr, t.orgId, t.emp.id, profile({ jobTitle: 'x'.repeat(81) })).expect(400);
    await put(t.hr, t.orgId, t.emp.id, profile({ note: 'x'.repeat(301) })).expect(400);

    const list = (await ctx.http.get(`/v1/orgs/${t.orgId}/hr/employees`).set(bearer(t.hr.token)).expect(200)).body.items;
    expect(list).toHaveLength(6);
    expect(list.find((e: { userId: string }) => e.userId === t.emp.id).profile.jobTitle).toBe('Vendeur');
    expect(list.find((e: { userId: string }) => e.userId === t.emp2.id).profile).toBeNull();
    await ctx.http.get(`/v1/orgs/${t.orgId}/hr/employees`).set(bearer(t.emp.token)).expect(403);
    await ctx.http.get(`/v1/orgs/${t.orgId}/hr/employees`).set(bearer(t.stranger.token)).expect(404);

    const { rows } = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'hr.profile_saved' AND metadata->>'orgId' = $1`, [t.orgId]);
    expect(JSON.stringify(rows)).not.toContain('NOTE-RH-SECRETE');
  });
});

describe('leaves', () => {
  it('shows the reason of a sick leave only to its author and to hr.manage, not to the direct manager', async () => {
    const t = await team();
    await put(t.hr, t.orgId, t.emp.id, profile({ annualLeaveDays: 20, managerUserId: t.manager.id })).expect(200);
    const sick = (await askLeave(t.emp, t.orgId, { kind: 'sick', startsOn: `${YEAR}-04-06`, endsOn: `${YEAR}-04-07`, reason: 'MOTIF-MEDICAL' }).expect(201)).body;
    expect(sick.reason).toBe('MOTIF-MEDICAL');
    const listed = async (who: { token: string }) => (await ctx.http.get(`/v1/orgs/${t.orgId}/hr/leaves`).set(bearer(who.token)).expect(200)).body.items.find((x: { id: string }) => x.id === sick.id);
    expect((await listed(t.hr)).reason).toBe('MOTIF-MEDICAL');
    expect((await listed(t.manager)).reason).toBeNull();
    const mine = (await ctx.http.get(`/v1/me/hr/leaves?orgId=${t.orgId}`).set(bearer(t.emp.token)).expect(200)).body.items.find((x: { id: string }) => x.id === sick.id);
    expect(mine.reason).toBe('MOTIF-MEDICAL');
    expect((await decide(t.manager, t.orgId, sick.id, 'approve').expect(200)).body.reason).toBeNull();
  });

  it('computes days, refuses overlaps, and only HR or the direct manager decide (never the employee)', async () => {
    const t = await team();
    await put(t.hr, t.orgId, t.emp.id, profile({ annualLeaveDays: 20, managerUserId: t.manager.id })).expect(200);
    const s = `${YEAR}-01-05`;
    const e = `${YEAR}-01-09`;
    const l1 = (await askLeave(t.emp, t.orgId, { kind: 'annual', startsOn: s, endsOn: e, reason: 'MOTIF-PRIVE' }).expect(201)).body;
    expect(l1).toMatchObject({ days: 5, status: 'requested', userId: t.emp.id, kind: 'annual' });
    expect((await askLeave(t.emp, t.orgId, { kind: 'sick', startsOn: `${YEAR}-02-10`, endsOn: `${YEAR}-02-10` }).expect(201)).body.days).toBe(1);

    const overlap = await askLeave(t.emp, t.orgId, { kind: 'sick', startsOn: e, endsOn: `${YEAR}-01-12` }).expect(409);
    expect(overlap.body.error.details.reason).toBe('leave_overlap');
    await askLeave(t.emp, t.orgId, { kind: 'sick', startsOn: `${YEAR}-01-10`, endsOn: `${YEAR}-01-12` }).expect(201);
    await askLeave(t.emp, t.orgId, { kind: 'sick', startsOn: e, endsOn: s }).expect(400);
    await askLeave(t.emp, t.orgId, { kind: 'holiday', startsOn: s, endsOn: e }).expect(400);
    await askLeave(t.emp, t.orgId, { kind: 'annual', startsOn: '2026-02-30', endsOn: '2026-03-01' }).expect(400);
    await askLeave(t.emp, t.orgId, { kind: 'annual', startsOn: '2026-01-01', endsOn: '2028-01-01' }).expect(400);
    // Another employee is not blocked by it.
    await askLeave(t.emp2, t.orgId, { kind: 'annual', startsOn: s, endsOn: e }).expect(201);
    await askLeave(t.stranger, t.orgId, { kind: 'annual', startsOn: s, endsOn: e }).expect(404);

    // Who decides.
    await decide(t.emp, t.orgId, l1.id, 'approve').expect(403);
    await decide(t.emp2, t.orgId, l1.id, 'approve').expect(403);
    await decide(t.fin, t.orgId, l1.id, 'approve').expect(403);
    await decide(t.stranger, t.orgId, l1.id, 'approve').expect(404);
    const ok = (await decide(t.manager, t.orgId, l1.id, 'approve').expect(200)).body;
    expect(ok).toMatchObject({ status: 'approved', decidedBy: t.manager.id });
    expect((await decide(t.hr, t.orgId, l1.id, 'reject').expect(409)).body.error.details.reason).toBe('leave_not_pending');
    // The manager is NOT the manager of emp2: only HR decides emp2's request.
    const l2 = (await ctx.http.get(`/v1/orgs/${t.orgId}/hr/leaves?status=requested`).set(bearer(t.hr.token)).expect(200)).body.items.find((x: { userId: string }) => x.userId === t.emp2.id);
    await decide(t.manager, t.orgId, l2.id, 'approve').expect(403);
    expect((await decide(t.hr, t.orgId, l2.id, 'reject').expect(200)).body.status).toBe('rejected');
    // Nobody decides their own, even HR.
    const own = (await askLeave(t.hr, t.orgId, { kind: 'other', startsOn: `${YEAR}-03-02`, endsOn: `${YEAR}-03-03` }).expect(201)).body;
    await decide(t.hr, t.orgId, own.id, 'approve').expect(403);
    await decide(t.owner, t.orgId, own.id, 'approve').expect(200);

    // Lists: HR sees everything, the manager only the reports', an employee nothing.
    const all = (await ctx.http.get(`/v1/orgs/${t.orgId}/hr/leaves`).set(bearer(t.hr.token)).expect(200)).body;
    expect(all.items.length).toBe(5);
    const page1 = (await ctx.http.get(`/v1/orgs/${t.orgId}/hr/leaves?limit=2`).set(bearer(t.hr.token)).expect(200)).body;
    expect(page1.items).toHaveLength(2);
    const page2 = (await ctx.http.get(`/v1/orgs/${t.orgId}/hr/leaves?limit=2&cursor=${page1.nextCursor}`).set(bearer(t.hr.token)).expect(200)).body;
    expect(page2.items[0].id).not.toBe(page1.items[0].id);
    const reports = (await ctx.http.get(`/v1/orgs/${t.orgId}/hr/leaves`).set(bearer(t.manager.token)).expect(200)).body.items;
    expect(reports.every((x: { userId: string }) => x.userId === t.emp.id)).toBe(true);
    expect((await ctx.http.get(`/v1/orgs/${t.orgId}/hr/leaves`).set(bearer(t.emp.token)).expect(200)).body.items).toHaveLength(0);

    // The employee's own view and indicative balance (5 annual days approved of a quota of 20).
    const mine = (await ctx.http.get(`/v1/me/hr/leaves?orgId=${t.orgId}`).set(bearer(t.emp.token)).expect(200)).body;
    expect(mine.items).toHaveLength(3);
    expect(mine.balance).toMatchObject({ year: YEAR, annualQuotaDays: 20, annualUsedDays: 5, annualPendingDays: 0, annualRemainingDays: 15 });
    await ctx.http.get(`/v1/me/hr/leaves?orgId=${t.orgId}`).set(bearer(t.stranger.token)).expect(404);
    await ctx.http.get('/v1/me/hr/leaves').set(bearer(t.emp.token)).expect(400);

    // Notifications are generic and go to HR and the manager (not the requester); the decision goes to the employee.
    const req = await ctx.sql.query(`SELECT user_id, body FROM notifications WHERE data->>'type' = 'hr.leave_requested' AND data->>'leaveId' = $1`, [l1.id]);
    expect(req.rows.map((r: { user_id: string }) => r.user_id).sort()).toEqual([t.owner.id, t.hr.id, t.manager.id].sort());
    expect(JSON.stringify(req.rows)).not.toContain('MOTIF-PRIVE');
    const dec = await ctx.sql.query(`SELECT user_id FROM notifications WHERE data->>'type' = 'hr.leave_decided' AND data->>'leaveId' = $1`, [l1.id]);
    expect(dec.rows.map((r: { user_id: string }) => r.user_id)).toEqual([t.emp.id]);

    const { rows } = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE action LIKE 'hr.leave_%' AND metadata->>'orgId' = $1`, [t.orgId]);
    expect(rows.length).toBeGreaterThan(4);
    expect(JSON.stringify(rows)).not.toContain('MOTIF-PRIVE');
  });

  it('cancels: pending anytime, approved only before it starts, never someone else\'s', async () => {
    const t = await team();
    const future = (await askLeave(t.emp, t.orgId, { kind: 'annual', startsOn: date(400), endsOn: date(402) }).expect(201)).body;
    await ctx.http.post(`/v1/orgs/${t.orgId}/hr/leaves/${future.id}/cancel`).set(bearer(t.emp2.token)).expect(404);
    expect((await ctx.http.post(`/v1/orgs/${t.orgId}/hr/leaves/${future.id}/cancel`).set(bearer(t.emp.token)).expect(200)).body.status).toBe('cancelled');
    expect((await ctx.http.post(`/v1/orgs/${t.orgId}/hr/leaves/${future.id}/cancel`).set(bearer(t.emp.token)).expect(409)).body.error.details.reason).toBe('leave_not_cancellable');
    // A cancelled leave no longer blocks the dates.
    const again = (await askLeave(t.emp, t.orgId, { kind: 'annual', startsOn: date(400), endsOn: date(402) }).expect(201)).body;
    await decide(t.hr, t.orgId, again.id, 'approve').expect(200);
    await ctx.http.post(`/v1/orgs/${t.orgId}/hr/leaves/${again.id}/cancel`).set(bearer(t.emp.token)).expect(200);
    const past = (await askLeave(t.emp, t.orgId, { kind: 'sick', startsOn: date(-3), endsOn: date(-2) }).expect(201)).body;
    await decide(t.hr, t.orgId, past.id, 'approve').expect(200);
    await ctx.http.post(`/v1/orgs/${t.orgId}/hr/leaves/${past.id}/cancel`).set(bearer(t.emp.token)).expect(409);
  });
});

describe('shifts', () => {
  it('plans without overlap per employee; HR or the direct manager only; employees read their own', async () => {
    const t = await team();
    await put(t.hr, t.orgId, t.emp.id, profile({ managerUserId: t.manager.id })).expect(200);
    const day = date(5);
    const a = (await shift(t.manager, t.orgId, { userId: t.emp.id, shiftDate: day, startsAt: '08:00', endsAt: '12:00', note: 'Ouverture' }).expect(201)).body;
    expect(a).toMatchObject({ userId: t.emp.id, startsAt: '08:00', endsAt: '12:00', note: 'Ouverture', shiftDate: day });
    expect((await shift(t.manager, t.orgId, { userId: t.emp.id, shiftDate: day, startsAt: '11:00', endsAt: '13:00' }).expect(409)).body.error.details.reason).toBe('shift_overlap');
    await shift(t.manager, t.orgId, { userId: t.emp.id, shiftDate: day, startsAt: '12:00', endsAt: '16:00' }).expect(201);
    await shift(t.manager, t.orgId, { userId: t.emp.id, shiftDate: date(6), startsAt: '09:00', endsAt: '10:00' }).expect(201);
    await shift(t.manager, t.orgId, { userId: t.emp.id, shiftDate: day, startsAt: '18:00', endsAt: '17:00' }).expect(400);
    await shift(t.manager, t.orgId, { userId: t.emp.id, shiftDate: day, startsAt: '8:00', endsAt: '17:00' }).expect(400);
    // Another employee has no overlap with emp's shifts.
    await shift(t.hr, t.orgId, { userId: t.emp2.id, shiftDate: day, startsAt: '08:00', endsAt: '12:00' }).expect(201);
    // Not a report of the manager / not HR / not a member.
    await shift(t.manager, t.orgId, { userId: t.emp2.id, shiftDate: date(7), startsAt: '08:00', endsAt: '12:00' }).expect(403);
    await shift(t.emp, t.orgId, { userId: t.emp.id, shiftDate: date(7), startsAt: '08:00', endsAt: '12:00' }).expect(403);
    await shift(t.hr, t.orgId, { userId: t.stranger.id, shiftDate: date(7), startsAt: '08:00', endsAt: '12:00' }).expect(404);

    const range = `from=${date(0)}&to=${date(10)}`;
    const mine = (await ctx.http.get(`/v1/me/hr/shifts?orgId=${t.orgId}&${range}`).set(bearer(t.emp.token)).expect(200)).body.items;
    expect(mine.map((s: { startsAt: string }) => s.startsAt)).toEqual(['08:00', '12:00', '09:00']);
    expect(mine.every((s: { userId: string }) => s.userId === t.emp.id)).toBe(true);
    await ctx.http.get(`/v1/me/hr/shifts?orgId=${t.orgId}&from=${date(0)}&to=${date(100)}`).set(bearer(t.emp.token)).expect(400);
    await ctx.http.get(`/v1/me/hr/shifts?orgId=${t.orgId}&${range}`).set(bearer(t.stranger.token)).expect(404);
    expect((await ctx.http.get(`/v1/orgs/${t.orgId}/hr/shifts?${range}`).set(bearer(t.hr.token)).expect(200)).body.items).toHaveLength(4);
    expect((await ctx.http.get(`/v1/orgs/${t.orgId}/hr/shifts?${range}`).set(bearer(t.manager.token)).expect(200)).body.items).toHaveLength(3);
    expect((await ctx.http.get(`/v1/orgs/${t.orgId}/hr/shifts?${range}`).set(bearer(t.emp.token)).expect(200)).body.items).toHaveLength(0);

    await ctx.http.delete(`/v1/orgs/${t.orgId}/hr/shifts/${a.id}`).set(bearer(t.emp.token)).expect(403);
    await ctx.http.delete(`/v1/orgs/${t.orgId}/hr/shifts/${a.id}`).set(bearer(t.manager.token)).expect(204);
    await ctx.http.delete(`/v1/orgs/${t.orgId}/hr/shifts/${a.id}`).set(bearer(t.manager.token)).expect(404);
    // Freed: the same slot can be planned again.
    await shift(t.manager, t.orgId, { userId: t.emp.id, shiftDate: day, startsAt: '08:00', endsAt: '12:00' }).expect(201);
  });
});

describe('salary register (hand-entered statements)', () => {
  it('finance and HR only; an employee sees only their own lines; amounts are never audited', async () => {
    const t = await team();
    const line = (await salary(t.fin, t.orgId, { userId: t.emp.id, period: `${YEAR}-01-01`, grossMinor: 123456, currency: 'USD', note: 'Janvier' }).expect(200)).body;
    expect(line).toMatchObject({ userId: t.emp.id, period: `${YEAR}-01-01`, grossMinor: 123456, currency: 'USD', recordedBy: t.fin.id });
    // Same month again replaces the line.
    const replaced = (await salary(t.hr, t.orgId, { userId: t.emp.id, period: `${YEAR}-01-01`, grossMinor: 130000, currency: 'USD' }).expect(200)).body;
    expect(replaced.id).toBe(line.id);
    expect(replaced.grossMinor).toBe(130000);
    await salary(t.hr, t.orgId, { userId: t.emp.id, period: `${YEAR}-02-01`, grossMinor: 140000, currency: 'CDF' }).expect(200);
    await salary(t.hr, t.orgId, { userId: t.emp2.id, period: `${YEAR}-01-01`, grossMinor: 99999, currency: 'USD' }).expect(200);

    await salary(t.fin, t.orgId, { userId: t.emp.id, period: `${YEAR}-01-15`, grossMinor: 1, currency: 'USD' }).expect(400);
    await salary(t.fin, t.orgId, { userId: t.emp.id, period: `${YEAR}-01-01`, grossMinor: -1, currency: 'USD' }).expect(400);
    await salary(t.fin, t.orgId, { userId: t.emp.id, period: `${YEAR}-01-01`, grossMinor: 1, currency: 'EUR' }).expect(400);
    await salary(t.manager, t.orgId, { userId: t.emp.id, period: `${YEAR}-03-01`, grossMinor: 1, currency: 'USD' }).expect(403);
    await salary(t.emp, t.orgId, { userId: t.emp.id, period: `${YEAR}-03-01`, grossMinor: 1, currency: 'USD' }).expect(403);
    await salary(t.stranger, t.orgId, { userId: t.emp.id, period: `${YEAR}-03-01`, grossMinor: 1, currency: 'USD' }).expect(404);
    await salary(t.fin, t.orgId, { userId: t.stranger.id, period: `${YEAR}-03-01`, grossMinor: 1, currency: 'USD' }).expect(404);

    const all = (await ctx.http.get(`/v1/orgs/${t.orgId}/hr/salary`).set(bearer(t.fin.token)).expect(200)).body.items;
    expect(all).toHaveLength(3);
    expect((await ctx.http.get(`/v1/orgs/${t.orgId}/hr/salary?userId=${t.emp2.id}`).set(bearer(t.hr.token)).expect(200)).body.items).toHaveLength(1);
    await ctx.http.get(`/v1/orgs/${t.orgId}/hr/salary`).set(bearer(t.emp.token)).expect(403);
    await ctx.http.get(`/v1/orgs/${t.orgId}/hr/salary`).set(bearer(t.manager.token)).expect(403);
    await ctx.http.get(`/v1/orgs/${t.orgId}/hr/salary`).set(bearer(t.stranger.token)).expect(404);

    const mine = (await ctx.http.get(`/v1/me/hr/salary?orgId=${t.orgId}`).set(bearer(t.emp.token)).expect(200)).body.items;
    expect(mine).toHaveLength(2);
    expect(mine.every((l: { userId: string }) => l.userId === t.emp.id)).toBe(true);
    expect((await ctx.http.get(`/v1/me/hr/salary?orgId=${t.orgId}`).set(bearer(t.emp2.token)).expect(200)).body.items.map((l: { grossMinor: number }) => l.grossMinor)).toEqual([99999]);
    await ctx.http.get(`/v1/me/hr/salary?orgId=${t.orgId}`).set(bearer(t.stranger.token)).expect(404);

    const { rows } = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE action LIKE 'hr.salary_%' AND metadata->>'orgId' = $1`, [t.orgId]);
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows)).not.toMatch(/123456|130000|140000|99999|Janvier/);
    expect(rows[0].metadata).toMatchObject({ employeeId: t.emp.id, period: `${YEAR}-01-01` });

    // Another organisation's line cannot be deleted through this one.
    const other = await createOrg(t.stranger);
    await ctx.http.delete(`/v1/orgs/${other}/hr/salary/${line.id}`).set(bearer(t.stranger.token)).expect(404);
    await ctx.http.delete(`/v1/orgs/${t.orgId}/hr/salary/${line.id}`).set(bearer(t.emp.token)).expect(403);
    await ctx.http.delete(`/v1/orgs/${t.orgId}/hr/salary/${line.id}`).set(bearer(t.fin.token)).expect(204);
    expect((await ctx.http.get(`/v1/me/hr/salary?orgId=${t.orgId}`).set(bearer(t.emp.token)).expect(200)).body.items).toHaveLength(1);
  });
});

describe('account export and deletion', () => {
  it('exports the user\'s own HR data (no HR note) and erases it with the account', async () => {
    const t = await team();
    await put(t.hr, t.orgId, t.emp.id, profile({ annualLeaveDays: 10, note: 'NOTE-RH', managerUserId: t.manager.id })).expect(200);
    await put(t.hr, t.orgId, t.emp2.id, profile({ managerUserId: t.manager.id })).expect(200);
    await askLeave(t.emp, t.orgId, { kind: 'annual', startsOn: date(50), endsOn: date(51), reason: 'Famille' }).expect(201);
    await askLeave(t.emp2, t.orgId, { kind: 'annual', startsOn: date(50), endsOn: date(51) }).expect(201);
    await shift(t.hr, t.orgId, { userId: t.emp.id, shiftDate: date(3), startsAt: '08:00', endsAt: '12:00' }).expect(201);
    await shift(t.hr, t.orgId, { userId: t.emp2.id, shiftDate: date(3), startsAt: '08:00', endsAt: '12:00' }).expect(201);
    await salary(t.hr, t.orgId, { userId: t.emp.id, period: `${YEAR}-01-01`, grossMinor: 5555, currency: 'USD' }).expect(200);
    await salary(t.hr, t.orgId, { userId: t.emp2.id, period: `${YEAR}-01-01`, grossMinor: 7777, currency: 'USD' }).expect(200);

    const exp = (await ctx.http.get('/v1/me/export').set(bearer(t.emp.token)).expect(200)).body;
    expect(exp.hr.profiles).toHaveLength(1);
    expect(exp.hr.profiles[0]).toMatchObject({ orgId: t.orgId, jobTitle: 'Vendeur', annualLeaveDays: 10 });
    expect(exp.hr.leaves).toHaveLength(1);
    expect(exp.hr.shifts).toHaveLength(1);
    expect(exp.hr.salary).toEqual([expect.objectContaining({ grossMinor: 5555, period: `${YEAR}-01-01` })]);
    expect(JSON.stringify(exp)).not.toContain('NOTE-RH');
    expect(JSON.stringify(exp.hr)).not.toContain('7777');

    await ctx.http.post('/v1/me/deletion-request').set(bearer(t.emp.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [t.emp.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    for (const table of ['employee_profiles', 'leave_requests', 'work_shifts', 'salary_register']) {
      const gone = await ctx.sql.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [t.emp.id]);
      expect(gone.rows[0].n, table).toBe(0);
      const kept = await ctx.sql.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [t.emp2.id]);
      expect(kept.rows[0].n, table).toBe(1);
    }

    // A manager's deletion clears the reference, the reports' profiles stay.
    await ctx.http.post('/v1/me/deletion-request').set(bearer(t.manager.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [t.manager.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM employee_profiles WHERE manager_user_id = $1`, [t.manager.id])).rows[0].n).toBe(0);
    expect((await ctx.sql.query(`SELECT manager_user_id FROM employee_profiles WHERE user_id = $1`, [t.emp2.id])).rows).toEqual([{ manager_user_id: null }]);
  });
});
