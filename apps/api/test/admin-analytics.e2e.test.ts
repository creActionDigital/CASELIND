import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Platform analytics (CDC §26): aggregates only, dense series, no personal data. */
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
  name: string;
}
async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle, name: me.body.displayName };
}
let n = 0;
async function org(owner: TU, name: string): Promise<string> {
  n += 1;
  return (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `ana-${Date.now().toString(36)}-${n}`, name, kind: 'shop' }).expect(201)).body.id;
}
const order = (buyer: TU, orgId: string, currency: string, status: string, total: number, age: string) =>
  ctx.sql.query(
    `INSERT INTO orders (number, buyer_id, org_id, client_id, currency, status, subtotal_minor, total_minor, payment_method, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'cash_on_delivery', now() - $8::interval)`,
    [`A-${randomUUID()}`, buyer.id, orgId, randomUUID(), currency, status, total, age],
  );
const overview = (u: TU | null, qs = '') => {
  const r = ctx.http.get(`/v1/admin/analytics/overview${qs}`);
  return u ? r.set(bearer(u.token)) : r;
};

describe('admin analytics overview', () => {
  it('is reserved to administrators and validates the period', async () => {
    const [admin, plain] = [await user(['user', 'admin']), await user()];
    await overview(null).expect(401);
    await overview(plain).expect(403);
    await overview(admin, '?days=5').expect(400);
    await overview(admin, '?days=abc').expect(400);
    const def = await overview(admin).expect(200);
    expect(def.body.days).toBe(30);
    expect(def.body.users.newByDay).toHaveLength(30);
    expect((await overview(admin, '?days=7').expect(200)).body.users.activeByDay).toHaveLength(7);
    expect((await overview(admin, '?days=90').expect(200)).body.messages.byDay).toHaveLength(90);
  });

  it('aggregates seeded data into dense series and exposes no personal data', async () => {
    const [admin, owner, ownerB, buyer, c, d] = [await user(['user', 'admin']), await user(), await user(), await user(), await user(), await user()];
    const orgA = await org(owner, 'Boutique Alpha');
    const orgB = await org(ownerB, 'Boutique Beta');

    await order(buyer, orgA, 'USD', 'delivered', 1_000, '0 days');
    await order(buyer, orgA, 'USD', 'confirmed', 3_000, '5 days');
    await order(buyer, orgA, 'USD', 'cancelled', 9_999, '1 day'); // ignored
    await order(buyer, orgB, 'USD', 'delivered', 500, '2 days');
    await order(buyer, orgA, 'CDF', 'delivered', 20_000, '1 day');
    await order(buyer, orgA, 'USD', 'delivered', 7_000, '20 days'); // outside 7 days

    await ctx.sql.query(`INSERT INTO pos_sales (org_id, client_id, currency, total_minor, payment_method, lines) VALUES ($1, $2, 'USD', 800, 'cash', '[]'::jsonb)`, [orgA, randomUUID()]);
    await ctx.sql.query(
      `INSERT INTO pos_sales (org_id, client_id, currency, total_minor, payment_method, lines, voided_at) VALUES ($1, $2, 'USD', 5000, 'cash', '[]'::jsonb, now())`,
      [orgA, randomUUID()],
    );

    // retention: c came back 10 days after signing up, d did not
    await ctx.sql.query(`UPDATE users SET created_at = now() - interval '20 days' WHERE id = ANY($1::uuid[])`, [[c.id, d.id]]);
    // The active-days counter (not the 7-day refresh tokens) feeds the curves: c and d were last seen 20 days ago, c again 10 days ago.
    await ctx.sql.query(`UPDATE user_active_days SET day = (now() - interval '20 days')::date WHERE user_id = ANY($1::uuid[])`, [[c.id, d.id]]);
    await ctx.sql.query(`INSERT INTO user_active_days (user_id, day) VALUES ($1, (now() - interval '10 days')::date)`, [c.id]);

    // messages, posts, reports, AI
    const conv = (await ctx.http.post('/v1/conversations').set(bearer(owner.token)).send({ kind: 'direct', userId: buyer.id }).expect(201)).body.id;
    for (const body of ['Bonjour', 'Salut']) {
      await ctx.http.post(`/v1/conversations/${conv}/messages`).set(bearer(owner.token)).send({ clientId: randomUUID(), kind: 'text', body }).expect(201);
    }
    for (const age of ['0 days', '3 days']) {
      await ctx.sql.query(`INSERT INTO posts (author_id, client_id, kind, body, visibility, created_at) VALUES ($1, $2, 'text', 'Mon billet prive', 'public', now() - $3::interval)`, [buyer.id, randomUUID(), age]);
    }
    await ctx.sql.query(`INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES ($1, 'user', $2, 'spam', 'texte du signalement')`, [buyer.id, c.id]);
    await ctx.sql.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, status, resolution, resolved_at, resolved_by) VALUES ($1, 'user', $2, 'spam', 'resolved', 'dismiss', now(), $3)`,
      [owner.id, d.id, admin.id],
    );
    await ctx.sql.query(`INSERT INTO ai_usage_daily (user_id, day, count) VALUES ($1, (now() AT TIME ZONE 'UTC')::date, 5), ($1, (now() AT TIME ZONE 'UTC')::date - 2, 3)`, [buyer.id]);

    const res = await overview(admin, '?days=7').expect(200);
    const b = res.body;
    expect(b.days).toBe(7);
    expect(b.from < b.to).toBe(true);

    // orders: cancelled and out-of-window ignored; per currency; average basket
    const usd = b.orders.byCurrency.find((x: { currency: string }) => x.currency === 'USD');
    expect(usd).toMatchObject({ count: 3, amountMinor: 4_500, averageMinor: 1_500 });
    expect(usd.byDay).toHaveLength(7);
    expect(usd.byDay.filter((x: { count: number }) => x.count === 0)).toHaveLength(4); // dense: days without sales are 0
    expect(b.orders.byCurrency.find((x: { currency: string }) => x.currency === 'CDF')).toMatchObject({ count: 1, amountMinor: 20_000 });
    expect(b.pos.byCurrency).toHaveLength(1);
    expect(b.pos.byCurrency[0]).toMatchObject({ currency: 'USD', count: 1, amountMinor: 800 }); // the voided sale is not counted

    // the 30 days window brings the old order back
    const wide = (await overview(admin, '?days=30').expect(200)).body;
    expect(wide.orders.byCurrency.find((x: { currency: string }) => x.currency === 'USD')).toMatchObject({ count: 4, amountMinor: 11_500 });

    // top organisations per currency, ranked
    const topUsd = b.topOrganizations.find((x: { currency: string }) => x.currency === 'USD').items;
    expect(topUsd.map((i: { name: string }) => i.name)).toEqual(['Boutique Alpha', 'Boutique Beta']);
    expect(topUsd[0]).toMatchObject({ organizationId: orgA, orders: 2, amountMinor: 4_000 });

    expect(b.organizations).toMatchObject({ total: 2, verified: 0, suspended: 0 });
    expect(b.messages.total).toBe(2);
    expect(b.messages.byDay.at(-1).value).toBe(2);
    expect(b.posts.total).toBe(2);
    expect(b.reports).toMatchObject({ open: 1, createdInPeriod: 2, resolvedInPeriod: 1 });
    expect(b.ai.requests).toBe(8);
    expect(b.ai.byDay).toHaveLength(7);

    // users: new per day (dense), active per day, D7 retention
    expect(b.users.total).toBeGreaterThanOrEqual(6);
    const today = b.users.newByDay.at(-1);
    expect(today.day).toBe(b.to);
    expect(b.users.newInPeriod).toBe(6); // 2 of the first test and admin, owner, ownerB, buyer signed up today; c and d are 20 days old
    const wideUsers = wide.users;
    expect(wideUsers.newInPeriod).toBe(8);
    expect(wideUsers.retentionD7).toEqual({ cohort: 2, retained: 1, ratePercent: 50 });
    const tenDaysAgo = wideUsers.activeByDay.find((p: { day: string }) => p.day === new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10));
    expect(tenDaysAgo.value).toBe(1);
    expect(wideUsers.activeByDay.at(-1).value).toBeGreaterThanOrEqual(4);

    // privacy: names, handles and free texts of people never appear; the organisation name does
    const text = JSON.stringify(res.body) + JSON.stringify(wide);
    for (const secret of [buyer.handle, buyer.name, owner.handle, c.handle, 'Mon billet prive', 'texte du signalement', 'Bonjour']) expect(text).not.toContain(secret);
    expect(text).toContain('Boutique Alpha');
  });
});
