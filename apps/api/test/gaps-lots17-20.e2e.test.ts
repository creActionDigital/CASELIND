import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key IN ('school', 'health', 'games')`);
  await ctx.sql.query(`INSERT INTO feature_flags (key, description, enabled) VALUES ('commerce', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`);
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  refresh: string;
  id: string;
  handle: string;
}
async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, refresh: tokens.refreshToken, id: me.body.id, handle: me.body.handle };
}
type M = 'get' | 'post' | 'put' | 'patch' | 'delete';
const call = (method: M, u: TU | null, path: string, body?: Record<string, unknown>) => {
  const r = ctx.http[method](`/v1${path}`);
  return (u ? r.set(bearer(u.token)) : r).send(body ?? {});
};
let n = 0;
async function org(owner: TU, kind: string): Promise<string> {
  n += 1;
  return (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `gap-${Date.now().toString(36)}-${n}`, name: 'Org Gap', kind }).expect(201)).body.id;
}
const NIL = '00000000-0000-4000-8000-000000000000';

describe('governance gaps (lot 20 admin)', () => {
  it('needs a session (401), refuses bad enums and malformed ids, and a suspended account cannot refresh', async () => {
    const [admin, target] = [await user(['user', 'admin']), await user()];
    await call('get', null, '/admin/users').expect(401);
    await call('put', null, `/admin/users/${target.id}/status`, { status: 'suspended', reason: 'sans session' }).expect(401);
    await call('put', admin, `/admin/users/${target.id}/status`, { status: 'banned', reason: 'enum inconnue' }).expect(400);
    await call('put', admin, `/admin/users/${target.id}/status`, { status: 'suspended' }).expect(400); // reason missing
    await call('get', admin, '/admin/users?limit=1000').expect(400);
    await call('put', admin, '/admin/users/not-a-uuid/status', { status: 'suspended', reason: 'id invalide' }).expect(404);
    const o = await org(target, 'shop');
    await call('put', admin, `/admin/orgs/${o}/verification`, { status: 'gold', reason: 'enum inconnue' }).expect(400);

    await call('put', admin, `/admin/users/${target.id}/status`, { status: 'suspended', reason: 'abus repete' }).expect(204);
    await ctx.http.post('/v1/auth/refresh').send({ refreshToken: target.refresh }).expect(401);
  });
});

describe('school fees gaps (lot 17b)', () => {
  it('a fee belongs to its class; validation; a departed student cannot be marked; the regulated flag cuts the routes', async () => {
    const [head, pupil] = [await user(), await user()];
    const orgId = await org(head, 'school');
    const mk = async (name: string) => (await call('post', head, `/orgs/${orgId}/school/classes`, { name, yearLabel: '2026-2027' }).expect(201)).body.id as string;
    const [a, b] = [await mk('6e A'), await mk('6e B')];
    const base = (c: string) => `/orgs/${orgId}/school/classes/${c}`;
    await call('post', head, `${base(a)}/members`, { handle: pupil.handle, role: 'student' }).expect(204);
    await call('post', head, `${base(b)}/members`, { handle: pupil.handle, role: 'student' }).expect(204);

    const bad = (extra: Record<string, unknown>) => call('post', head, `${base(a)}/fees`, { title: 'Minerval', amountMinor: 5000, currency: 'USD', ...extra });
    await bad({ title: '   ' }).expect(400);
    await bad({ amountMinor: 50.5 }).expect(400);
    await bad({ amountMinor: -1 }).expect(400);
    await bad({ dueOn: '2027-02-29' }).expect(400); // not a leap year
    await call('post', null, `${base(a)}/fees`, { title: 'x', amountMinor: 1, currency: 'USD' }).expect(401);

    const fee = (await bad({}).expect(201)).body;
    // The fee of class A through class B of the same school: 404, never a cross-class read or write.
    await call('get', head, `${base(b)}/fees/${fee.id}/statuses`).expect(404);
    await call('post', head, `${base(b)}/fees/${fee.id}/mark`, { handle: pupil.handle, paid: true }).expect(404);
    await call('post', head, `${base(a)}/fees/${fee.id}/mark`, { handle: pupil.handle }).expect(400); // paid missing

    await call('post', head, `${base(a)}/fees/${fee.id}/mark`, { handle: pupil.handle, paid: true }).expect(204);
    await call('delete', pupil, `/me/school/classes/${a}`).expect(204); // the pupil leaves class A
    await call('post', head, `${base(a)}/fees/${fee.id}/mark`, { handle: pupil.handle, paid: false }).expect(404);
    expect((await call('get', head, `${base(a)}/fees/${fee.id}/statuses`).expect(200)).body.items).toEqual([]);
    expect((await call('get', pupil, '/me/school/fees').expect(200)).body.items.map((f: { id: string }) => f.id)).not.toContain(fee.id);

    await ctx.sql.query(`UPDATE feature_flags SET enabled = false WHERE key = 'school'`);
    try {
      expect((await call('get', head, `${base(a)}/fees`)).body.error.code).toBe('feature_disabled');
      expect((await call('get', pupil, '/me/school/fees')).body.error.code).toBe('feature_disabled');
    } finally {
      await ctx.sql.query(`UPDATE feature_flags SET enabled = true WHERE key = 'school'`);
    }
  });
});

describe('quiz gaps (lot 20)', () => {
  it('refuses malformed answer sheets and unknown ranking periods, and needs a session', async () => {
    const p = await user();
    await call('post', null, '/games/quiz/sessions').expect(401);
    await call('get', null, '/games/quiz/leaderboard').expect(401);
    await call('get', p, '/games/quiz/leaderboard?period=year').expect(400);
    const sid = NIL;
    await call('post', p, `/games/quiz/sessions/${sid}/answers`, {}).expect(400); // no answers at all
    await call('post', p, `/games/quiz/sessions/${sid}/answers`, { answers: [-1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }).expect(400);
    await call('post', p, `/games/quiz/sessions/${sid}/answers`, { answers: [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1] }).expect(400);
    await call('post', p, `/games/quiz/sessions/${sid}/answers`, { answers: 'oui' }).expect(400);
  });
});

describe('loyalty gaps (lot 16h)', () => {
  it('only the shop staff set the programme; consent is validated and idempotent', async () => {
    const [owner, stranger, buyer] = [await user(), await user(), await user()];
    const orgId = await org(owner, 'shop');
    const body = { enabled: true, pointsPerUnit: 2, currency: 'USD', rewardText: 'Cafe' };
    await call('put', null, `/orgs/${orgId}/loyalty`, body).expect(401);
    await call('put', stranger, `/orgs/${orgId}/loyalty`, body).expect(404);
    await call('put', owner, `/orgs/${orgId}/loyalty`, { ...body, enabled: 'yes' }).expect(400);
    await call('put', owner, `/orgs/${orgId}/loyalty`, { ...body, pointsPerUnit: 1.5 }).expect(400);
    await call('put', owner, `/orgs/${orgId}/loyalty`, body).expect(200);
    await call('put', owner, `/orgs/${orgId}/loyalty`, body).expect(200); // same body twice: no conflict
    await call('get', null, '/me/loyalty').expect(401);
    await call('put', buyer, '/me/marketing-consent', { optIn: 'yes' }).expect(400);
    await call('put', buyer, '/me/marketing-consent', {}).expect(400);
    for (let i = 0; i < 2; i += 1) expect((await call('put', buyer, '/me/marketing-consent', { optIn: true }).expect(200)).body).toEqual({ marketingConsent: true });
    expect((await call('get', buyer, '/me/loyalty').expect(200)).body.marketingConsent).toBe(true);
    await call('put', buyer, '/me/marketing-consent', { optIn: false }).expect(200);
    expect((await call('get', buyer, '/me/loyalty').expect(200)).body.marketingConsent).toBe(false);
  });
});

describe('health gaps (lot 18b)', () => {
  it('needs a session; sharing the record with a pending professional is refused; nobody books themselves', async () => {
    const [pro, patient] = [await user(), await user()];
    await call('get', null, '/me/health/entries').expect(401);
    await call('get', null, '/health-professionals').expect(401);
    await call('put', patient, '/me/health/consent', { version: '1' }).expect(200);
    await call('put', pro, '/me/health/professional', { kind: 'doctor', specialty: 'Médecine générale', licenseNumber: 'CNOM-999', city: 'Goma', bio: 'Adultes' }).expect(200);
    // Application still pending: not a professional yet.
    const pending = await call('post', patient, '/me/health/shares', { professionalId: pro.id, kinds: ['allergy'] });
    expect(pending.status).toBe(404);
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await call('post', patient, '/me/health/appointments', { professionalId: pro.id, startsAt: when, mode: 'in_person', reason: 'Controle' }).expect(404); // pending: no booking
    await call('put', pro, '/me/health/consent', { version: '1' }).expect(200);
    await call('post', pro, '/me/health/appointments', { professionalId: pro.id, startsAt: when, mode: 'in_person', reason: 'Moi-meme' }).expect(403);
    await call('get', patient, `/me/health/professional/patients/${pro.id}/record`).expect(404); // not a professional
  });
});
