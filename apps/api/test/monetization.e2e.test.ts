import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PremiumService } from '../src/premium/premium.service.js';
import { LedgerPort } from '../src/wallet/ledger.port.js';
import { bearer, createTestContext, type TestContext } from './helpers.js';
import { creatorKit, type TU } from './creator-helpers.js';

/** Premium, forfaits pros et publicité payante, en mode test (portefeuille fictif) : argent, droits, idempotence, diffusion. */
let ctx: TestContext;
let kit: ReturnType<typeof creatorKit>;

beforeAll(async () => {
  ctx = await createTestContext();
  kit = creatorKit(ctx);
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const day = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const fund = (to: { kind: 'user'; userId: string } | { kind: 'org'; orgId: string }, amountMinor: number) =>
  ctx.app.get(LedgerPort).transfer({ from: { kind: 'system', code: 'sandbox_funding' }, to, amountMinor, currency: 'USD', kind: 'sandbox_topup', idempotencyKey: randomUUID(), initiatedBy: null, metadata: {} });
const funded = async (usd = 100_000) => {
  const u = await kit.user();
  await fund({ kind: 'user', userId: u.id }, usd);
  return u;
};
const subscribe = (u: TU, extra: Record<string, unknown> = {}) =>
  ctx.http.post('/v1/me/subscription').set(bearer(u.token)).send({ clientId: randomUUID(), planCode: 'premium_month', currency: 'USD', pin: '1234', ...extra });
const state = async (u: TU, q = '') => (await ctx.http.get(`/v1/me/subscription${q}`).set(bearer(u.token)).expect(200)).body;
const badge = async (id: string, viewer: TU) => (await ctx.http.get(`/v1/users/${id}/premium`).set(bearer(viewer.token)).expect(200)).body.premium;
async function feesBalance(): Promise<number> {
  const r = await ctx.sql.query(`SELECT COALESCE(sum(balance_minor), 0)::int AS b FROM ledger_accounts WHERE owner_kind = 'system' AND system_code = 'fees' AND currency = 'USD'`);
  return r.rows[0].b;
}
async function orgOf(owner: TU): Promise<string> {
  const slug = `mon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return (await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: `Org ${slug}`, kind: 'shop' }).expect(201)).body.id;
}

describe('premium', () => {
  it('lists active plans and the admin sets the prices', async () => {
    kit.pinOk();
    const u = await kit.user();
    const admin = await kit.user(['admin']);
    const plans = (await ctx.http.get('/v1/premium/plans').set(bearer(u.token)).expect(200)).body.items;
    expect(plans.map((p: { code: string }) => p.code).sort()).toEqual(['premium_month', 'premium_year', 'pro_month', 'pro_year']);
    await ctx.http.put('/v1/admin/subscription-plans/premium_year').set(bearer(u.token)).send({ priceUsdMinor: 1, priceCdfMinor: 1 }).expect(403);
    await ctx.http.put('/v1/admin/subscription-plans/premium_year').set(bearer(admin.token)).send({ priceUsdMinor: 4000, priceCdfMinor: 11_000_000, active: true }).expect(200);
    const b = await funded();
    kit.bigLimits();
    const r = await subscribe(b, { planCode: 'premium_year' }).expect(201);
    expect(r.body.payment.amountMinor).toBe(4000);
    await ctx.http.put('/v1/admin/subscription-plans/premium_year').set(bearer(admin.token)).send({ priceUsdMinor: 4999, priceCdfMinor: 13_997_200, active: true }).expect(200);
  });

  it('subscribes once, pays the wallet, is idempotent and shows the badge', async () => {
    kit.pinOk();
    kit.bigLimits();
    const u = await funded();
    const other = await kit.user();
    const fees = await feesBalance();
    const body = { clientId: randomUUID(), planCode: 'premium_month', currency: 'USD', pin: '1234' };
    const r = await ctx.http.post('/v1/me/subscription').set(bearer(u.token)).send(body).expect(201);
    expect(r.body.mode).toBe('sandbox');
    expect(r.body.subscription.status).toBe('active');
    expect(r.body.payment.receiptNo).toMatch(/^CSL-/);
    expect(await kit.balance(u)).toBe(100_000 - 499);
    expect(await feesBalance()).toBe(fees + 499);
    expect(await badge(u.id, other)).toBe(true);
    expect(await badge(other.id, u)).toBe(false);

    const again = await ctx.http.post('/v1/me/subscription').set(bearer(u.token)).send(body).expect(200);
    expect(again.body.replayed).toBe(true);
    expect(await kit.balance(u)).toBe(100_000 - 499);
    await ctx.http.post('/v1/me/subscription').set(bearer(u.token)).send({ ...body, planCode: 'premium_year' }).expect(409);
    const dup = await subscribe(u).expect(409);
    expect(dup.body.details?.reason ?? dup.body.error?.details?.reason).toBe('already_subscribed');
    expect(await kit.balance(u)).toBe(100_000 - 499);
    const pays = (await ctx.http.get('/v1/me/subscription/payments').set(bearer(u.token)).expect(200)).body.items;
    expect(pays).toHaveLength(1);
  });

  it('refuses without funds, in an unknown plan and for an org plan on a personal subscription', async () => {
    kit.pinOk();
    kit.bigLimits();
    const poor = await kit.user();
    await subscribe(poor).expect(409);
    expect((await state(poor)).premium).toBe(false);
    const u = await funded();
    await subscribe(u, { planCode: 'nope' }).expect(404);
    await subscribe(u, { planCode: 'pro_month' }).expect(404);
    expect(await kit.balance(u)).toBe(100_000);
  });

  it('cancel keeps access until the period end; manual renewal extends; resubscribing after expiry works', async () => {
    kit.pinOk();
    kit.bigLimits();
    const u = await funded();
    await subscribe(u, { autoRenew: true }).expect(201);
    expect((await state(u)).subscription.autoRenew).toBe(true);
    const cancelled = (await ctx.http.post('/v1/me/subscription/cancel').set(bearer(u.token)).expect(200)).body;
    expect(cancelled.premium).toBe(true);
    expect(cancelled.subscription.autoRenew).toBe(false);
    expect(cancelled.subscription.cancelledAt).not.toBeNull();
    const before = new Date(cancelled.subscription.currentPeriodEnd).getTime();
    const r = await ctx.http.post('/v1/me/subscription/renew').set(bearer(u.token)).send({ clientId: randomUUID(), pin: '1234' }).expect(201);
    expect(new Date(r.body.subscription.currentPeriodEnd).getTime()).toBeGreaterThan(before + 27 * 86_400_000);
    expect(r.body.payment.kind).toBe('renewal');
    expect(await kit.balance(u)).toBe(100_000 - 2 * 499);
    await ctx.sql.query(`UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE user_id = $1`, [u.id]);
    expect((await state(u)).premium).toBe(false);
    await ctx.http.post('/v1/me/subscription/cancel').set(bearer(u.token)).expect(409);
    await subscribe(u).expect(201);
    expect((await state(u)).premium).toBe(true);
  });

  it('auto-renews a due subscription without a PIN and switches itself off when the balance is short', async () => {
    kit.pinOk();
    kit.bigLimits();
    const u = await funded(1000);
    await subscribe(u, { autoRenew: true }).expect(201);
    await ctx.sql.query(`UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE user_id = $1`, [u.id]);
    expect(await ctx.app.get(PremiumService).renewDue()).toBeGreaterThanOrEqual(1);
    expect(await kit.balance(u)).toBe(1000 - 2 * 499);
    expect((await state(u)).premium).toBe(true);
    await ctx.sql.query(`UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE user_id = $1`, [u.id]);
    await ctx.app.get(PremiumService).renewDue();
    const s = await state(u);
    expect(s.premium).toBe(false);
    expect(await kit.balance(u)).toBe(1000 - 2 * 499);
    expect((await ctx.sql.query(`SELECT auto_renew FROM subscriptions WHERE user_id = $1`, [u.id])).rows[0].auto_renew).toBe(false);
  });

  it('only admins list and cancel subscriptions', async () => {
    kit.pinOk();
    kit.bigLimits();
    const u = await funded();
    const admin = await kit.user(['admin']);
    const sub = (await subscribe(u).expect(201)).body.subscription;
    await ctx.http.get('/v1/admin/subscriptions').set(bearer(u.token)).expect(403);
    await ctx.http.post(`/v1/admin/subscriptions/${sub.id}/cancel`).set(bearer(u.token)).expect(403);
    const list = (await ctx.http.get('/v1/admin/subscriptions?status=active&limit=100').set(bearer(admin.token)).expect(200)).body.items;
    expect(list.some((s: { id: string }) => s.id === sub.id)).toBe(true);
    const done = await ctx.http.post(`/v1/admin/subscriptions/${sub.id}/cancel`).set(bearer(admin.token)).expect(200);
    expect(done.body.status).toBe('expired');
    expect((await state(u)).premium).toBe(false);
    await ctx.http.post(`/v1/admin/subscriptions/${sub.id}/cancel`).set(bearer(admin.token)).expect(409);
  });

  it('org plans: members only manage, owner pays when the org wallet is empty, the org wallet pays when funded', async () => {
    kit.pinOk();
    kit.bigLimits();
    const owner = await funded();
    const stranger = await funded();
    const orgId = await orgOf(owner);
    await subscribe(stranger, { planCode: 'pro_month', orgId }).expect(404);
    await ctx.http.get(`/v1/me/subscription?orgId=${orgId}`).set(bearer(stranger.token)).expect(404);
    await subscribe(owner, { planCode: 'premium_month', orgId }).expect(404);
    const r = await subscribe(owner, { planCode: 'pro_month', orgId }).expect(201);
    expect(r.body.payment.payer).toBe('user');
    expect(await kit.balance(owner)).toBe(100_000 - 1999);
    expect((await state(owner, `?orgId=${orgId}`)).premium).toBe(true);
    expect((await state(owner)).premium).toBe(false);

    const org2 = await orgOf(owner);
    await fund({ kind: 'org', orgId: org2 }, 5000);
    const r2 = await subscribe(owner, { planCode: 'pro_month', orgId: org2 }).expect(201);
    expect(r2.body.payment.payer).toBe('org');
    expect(await kit.balance(owner)).toBe(100_000 - 1999);
    const orgBal = await ctx.sql.query(`SELECT balance_minor::int AS b FROM ledger_accounts WHERE org_id = $1 AND currency = 'USD'`, [org2]);
    expect(orgBal.rows[0].b).toBe(5000 - 1999);
  });
});

describe('ads', () => {
  const campaign = (u: TU, postId: string, extra: Record<string, unknown> = {}) =>
    ctx.http.post('/v1/ads/campaigns').set(bearer(u.token)).send({
      clientId: randomUUID(),
      name: 'Ma campagne',
      objective: 'clicks',
      postId,
      placements: ['feed', 'marketplace'],
      budgetMinor: 1000,
      dailyBudgetMinor: 500,
      currency: 'USD',
      startsOn: day(),
      endsOn: day(7),
      pin: '1234',
      ...extra,
    });
  const review = (admin: TU, id: string, body: Record<string, unknown>) => ctx.http.post(`/v1/admin/ads/${id}/review`).set(bearer(admin.token)).send(body);
  const serve = async (u: TU, placement = 'marketplace') => (await ctx.http.get(`/v1/ads/serve?placement=${placement}`).set(bearer(u.token)).expect(200)).body.items;
  const click = (u: TU, id: string) => ctx.http.post(`/v1/ads/${id}/click`).set(bearer(u.token));
  const mine = async (u: TU, id: string) => (await ctx.http.get('/v1/ads/campaigns?limit=100').set(bearer(u.token)).expect(200)).body.items.find((c: { id: string }) => c.id === id);

  it('creates a pending campaign, debits the budget, is idempotent and validates', async () => {
    kit.pinOk();
    kit.bigLimits();
    const u = await funded();
    const post = await kit.post(u);
    const fees = await feesBalance();
    const body = { clientId: randomUUID() };
    const r = await campaign(u, post, body).expect(201);
    expect(r.body.campaign.status).toBe('pending');
    expect(await kit.balance(u)).toBe(100_000 - 1000);
    expect(await feesBalance()).toBe(fees + 1000);
    const again = await campaign(u, post, body).expect(200);
    expect(again.body.replayed).toBe(true);
    expect(await kit.balance(u)).toBe(100_000 - 1000);
    await campaign(u, post, { ...body, budgetMinor: 2000 }).expect(409);
    await campaign(u, post, { budgetMinor: 10 }).expect(400);
    await campaign(u, post, { startsOn: day(-3) }).expect(400);
    await campaign(u, post, { dailyBudgetMinor: 2000 }).expect(400);
    await campaign(u, post, { postId: undefined }).expect(400);
    const priv = await kit.post(u, 'prive', 'private');
    await campaign(u, priv).expect(409);
    const someoneElse = await kit.user();
    await campaign(someoneElse, post).expect(403);
    expect(await kit.balance(u)).toBe(100_000 - 1000);
  });

  it('is not served before approval; the moderation approves; only the owner manages; the audience country applies', async () => {
    kit.pinOk();
    kit.bigLimits();
    const u = await funded();
    const viewer = await kit.user();
    const mod = await kit.user(['moderator']);
    const post = await kit.post(u, 'Une promotion unique');
    const id = (await campaign(u, post, { audience: { country: 'CD', city: null, minAge: null, interests: [] } }).expect(201)).body.campaign.id;
    await ctx.sql.query(`UPDATE users SET country = 'CD' WHERE id = $1`, [viewer.id]);
    expect((await serve(viewer)).some((a: { campaignId: string }) => a.campaignId === id)).toBe(false);
    await review(viewer, id, { decision: 'approve' }).expect(403);
    await ctx.http.get('/v1/admin/ads').set(bearer(viewer.token)).expect(403);
    await review(mod, id, { decision: 'approve' }).expect(200);
    await review(mod, id, { decision: 'approve' }).expect(409);
    const ads = await serve(viewer);
    const ad = ads.find((a: { campaignId: string }) => a.campaignId === id);
    expect(ad).toMatchObject({ sponsored: true, postId: post, title: 'Une promotion unique' });
    expect((await serve(u)).some((a: { campaignId: string }) => a.campaignId === id)).toBe(false);
    expect((await serve(viewer, 'videos')).some((a: { campaignId: string }) => a.campaignId === id)).toBe(false);
    await ctx.sql.query(`UPDATE users SET country = 'FR' WHERE id = $1`, [viewer.id]);
    expect((await serve(viewer)).some((a: { campaignId: string }) => a.campaignId === id)).toBe(false);
    expect((await mine(u, id)).impressions).toBe(1);

    await ctx.http.post(`/v1/ads/campaigns/${id}/action`).set(bearer(viewer.token)).send({ action: 'pause' }).expect(404);
    await ctx.http.get(`/v1/ads/campaigns/${id}/stats`).set(bearer(viewer.token)).expect(404);
    const list = (await ctx.http.get('/v1/admin/ads?status=approved&limit=100').set(bearer(mod.token)).expect(200)).body.items;
    expect(list.find((c: { id: string }) => c.id === id).preview).toBe('Une promotion unique');
  });

  it('bills one click per viewer and day, never the owner, caps the daily budget and refunds the rest on exhaustion', async () => {
    kit.pinOk();
    kit.bigLimits();
    const u = await funded();
    const mod = await kit.user(['moderator']);
    const post = await kit.post(u);
    const id = (await campaign(u, post, { budgetMinor: 500, dailyBudgetMinor: 30 }).expect(201)).body.campaign.id;
    await review(mod, id, { decision: 'approve' }).expect(200);
    const v = [await kit.user(), await kit.user(), await kit.user(), await kit.user()];
    expect((await click(u, id).expect(200)).body.counted).toBe(false);
    expect((await click(v[0]!, id).expect(200)).body.counted).toBe(true);
    expect((await click(v[0]!, id).expect(200)).body.counted).toBe(false);
    expect((await click(v[1]!, id).expect(200)).body.counted).toBe(true);
    expect((await click(v[2]!, id).expect(200)).body.counted).toBe(true);
    // 3 clics x 10 = 30 : plafond quotidien atteint, le suivant n'est pas facturé et la campagne n'est plus servie.
    expect((await click(v[3]!, id).expect(200)).body.counted).toBe(false);
    expect((await serve(v[3]!)).some((a: { campaignId: string }) => a.campaignId === id)).toBe(false);
    const c = await mine(u, id);
    expect(c).toMatchObject({ clicks: 3, spentMinor: 30, status: 'approved' });
    const stats = (await ctx.http.get(`/v1/ads/campaigns/${id}/stats`).set(bearer(u.token)).expect(200)).body;
    expect(stats.days[0]).toMatchObject({ clicks: 3, spentMinor: 30 });

    // Arrêt : le budget non dépensé revient au portefeuille, une seule fois.
    const fees = await feesBalance();
    const before = await kit.balance(u);
    const stopped = (await ctx.http.post(`/v1/ads/campaigns/${id}/action`).set(bearer(u.token)).send({ action: 'stop' }).expect(200)).body;
    expect(stopped).toMatchObject({ status: 'stopped', refundedMinor: 470 });
    expect(await kit.balance(u)).toBe(before + 470);
    expect(await feesBalance()).toBe(fees - 470);
    await ctx.http.post(`/v1/ads/campaigns/${id}/action`).set(bearer(u.token)).send({ action: 'stop' }).expect(409);
    const billing = (await ctx.http.get('/v1/ads/billing').set(bearer(u.token)).expect(200)).body.items;
    expect(billing.filter((b: { campaignId: string }) => b.campaignId === id).map((b: { kind: string }) => b.kind).sort()).toEqual(['charge', 'refund']);
  });

  it('pauses and resumes; a rejection refunds the whole budget; a budget run out ends the campaign with the remainder refunded', async () => {
    kit.pinOk();
    kit.bigLimits();
    const u = await funded();
    const mod = await kit.user(['moderator']);
    const viewer = await kit.user();
    const post = await kit.post(u);
    const id = (await campaign(u, post).expect(201)).body.campaign.id;
    await ctx.http.post(`/v1/ads/campaigns/${id}/action`).set(bearer(u.token)).send({ action: 'pause' }).expect(409);
    await review(mod, id, { decision: 'approve' }).expect(200);
    await ctx.http.post(`/v1/ads/campaigns/${id}/action`).set(bearer(u.token)).send({ action: 'pause' }).expect(200);
    expect((await serve(viewer)).some((a: { campaignId: string }) => a.campaignId === id)).toBe(false);
    expect((await click(viewer, id).expect(200)).body.counted).toBe(false);
    await ctx.http.post(`/v1/ads/campaigns/${id}/action`).set(bearer(u.token)).send({ action: 'resume' }).expect(200);
    expect((await serve(viewer)).some((a: { campaignId: string }) => a.campaignId === id)).toBe(true);

    const before = await kit.balance(u);
    await review(mod, id, { decision: 'reject' }).expect(400);
    const rej = await review(mod, id, { decision: 'reject', reason: 'Contenu trompeur' }).expect(200);
    expect(rej.body).toMatchObject({ status: 'rejected', rejectionReason: 'Contenu trompeur', refundedMinor: 1000 });
    expect(await kit.balance(u)).toBe(before + 1000);
    await review(mod, id, { decision: 'reject', reason: 'encore' }).expect(409);

    const small = (await campaign(u, post, { budgetMinor: 500, dailyBudgetMinor: 500 }).expect(201)).body.campaign.id;
    await review(mod, small, { decision: 'approve' }).expect(200);
    const mid = await kit.balance(u);
    const clickers = await Promise.all(Array.from({ length: 50 }, () => kit.user()));
    for (const c of clickers) await click(c, small).expect(200);
    const done = await mine(u, small);
    expect(done).toMatchObject({ status: 'ended', clicks: 50, spentMinor: 500, refundedMinor: 0 });
    expect(await kit.balance(u)).toBe(mid);
  });

  it('settles a campaign whose dates passed and refunds the remainder', async () => {
    kit.pinOk();
    kit.bigLimits();
    const u = await funded();
    const post = await kit.post(u);
    const id = (await campaign(u, post).expect(201)).body.campaign.id;
    await ctx.sql.query(`UPDATE ad_campaigns SET starts_on = current_date - 5, ends_on = current_date - 1 WHERE id = $1`, [id]);
    const before = await kit.balance(u);
    const c = await mine(u, id);
    expect(c).toMatchObject({ status: 'ended', refundedMinor: 1000 });
    expect(await kit.balance(u)).toBe(before + 1000);
  });

  it('promotes a product only for an owner or an admin of its organization, paid by the org wallet when funded', async () => {
    kit.pinOk();
    kit.bigLimits();
    const owner = await funded();
    const outsider = await funded();
    const orgId = await orgOf(owner);
    const prod = await ctx.sql.query(`INSERT INTO products (org_id, title, status) VALUES ($1, 'Sac en cuir', 'published') RETURNING id`, [orgId]);
    const productId = prod.rows[0].id;
    await campaign(outsider, '', { postId: undefined, productId }).expect(404);
    await fund({ kind: 'org', orgId }, 3000);
    const mod = await kit.user(['moderator']);
    const r = await campaign(owner, '', { postId: undefined, productId, placements: ['marketplace', 'search'] }).expect(201);
    expect(r.body.campaign).toMatchObject({ productId, orgId });
    expect(await kit.balance(owner)).toBe(100_000);
    const id = r.body.campaign.id;
    await review(mod, id, { decision: 'approve' }).expect(200);
    const viewer = await kit.user();
    const ad = (await serve(viewer, 'search')).find((a: { campaignId: string }) => a.campaignId === id);
    expect(ad).toMatchObject({ productId, postId: null, title: 'Sac en cuir', sponsored: true });
    // Arrêt : le reliquat revient au portefeuille de l'organisation (payeur), pas au propriétaire.
    await ctx.http.post(`/v1/ads/campaigns/${id}/action`).set(bearer(owner.token)).send({ action: 'stop' }).expect(200);
    const orgBal = await ctx.sql.query(`SELECT balance_minor::int AS b FROM ledger_accounts WHERE org_id = $1 AND currency = 'USD'`, [orgId]);
    expect(orgBal.rows[0].b).toBe(3000);
    expect(await kit.balance(owner)).toBe(100_000);
  });

  it('inserts approved promoted posts in the feed, labelled sponsored', async () => {
    kit.pinOk();
    kit.bigLimits();
    const advertiser = await funded();
    const writer = await kit.user();
    const viewer = await kit.user();
    const mod = await kit.user(['moderator']);
    await kit.follow(viewer, writer);
    for (let i = 0; i < 6; i++) await kit.post(writer, `post ${i}`);
    const adPost = await kit.post(advertiser, 'Publicité du fil');
    const id = (await campaign(advertiser, adPost, { placements: ['feed'] }).expect(201)).body.campaign.id;
    await review(mod, id, { decision: 'approve' }).expect(200);
    const feed = (await ctx.http.get('/v1/feed?limit=20').set(bearer(viewer.token)).expect(200)).body.items;
    const idx = feed.findIndex((p: { id: string }) => p.id === adPost);
    expect(idx).toBe(5);
    expect(feed[idx].sponsored).toBe(true);
    expect((await ctx.http.post(`/v1/ads/posts/${adPost}/click`).set(bearer(viewer.token)).expect(200)).body.counted).toBe(true);
  });
});
