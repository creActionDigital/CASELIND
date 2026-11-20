import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WalletService } from '../src/ledger/wallet.service.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { PinVerifier } from '../src/wallet/pin.port.js';
import { bearer, createTestContext, type TestContext } from './helpers.js';
import { creatorKit, type TU } from './creator-helpers.js';

/** Tips and boosted posts: payments in the FICTITIOUS sandbox wallet (never real money). */
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

async function funded(amountMinor: number): Promise<TU> {
  const u = await kit.user();
  for (let left = amountMinor; left > 0; left -= 10_000) await kit.topup(u, Math.min(left, 10_000)).expect(201);
  return u;
}
const tipBody = (extra: Record<string, unknown> = {}) => ({ clientId: randomUUID(), amountMinor: 500, currency: 'USD', pin: '1234', ...extra });
const tipPost = (u: TU, postId: string, extra: Record<string, unknown> = {}) =>
  ctx.http.post(`/v1/posts/${postId}/tips`).set(bearer(u.token)).send(tipBody(extra));
const tipUser = (u: TU, userId: string, extra: Record<string, unknown> = {}) =>
  ctx.http.post(`/v1/users/${userId}/tips`).set(bearer(u.token)).send(tipBody(extra));
const boostBody = (extra: Record<string, unknown> = {}) => ({ clientId: randomUUID(), days: 3, budgetMinor: 500, currency: 'USD', pin: '1234', ...extra });
const boost = (u: TU, postId: string, extra: Record<string, unknown> = {}) =>
  ctx.http.post(`/v1/posts/${postId}/boost`).set(bearer(u.token)).send(boostBody(extra));
const feed = (u: TU, limit = 50) => ctx.http.get(`/v1/feed?limit=${limit}`).set(bearer(u.token));
const sponsoredIds = (items: { id: string; sponsored?: boolean }[]) => items.filter((p) => p.sponsored).map((p) => p.id);
/** Other tests of the file left running boosts: switch them off so a feed only carries the ones under test. */
const isolate = (keep: string[]) => ctx.sql.query(`UPDATE post_boosts SET status = 'cancelled' WHERE status = 'active' AND NOT (post_id = ANY($1::uuid[]))`, [keep]);
const systemBalance = async (): Promise<number> =>
  Number((await ctx.sql.query(`SELECT COALESCE(sum(balance_minor), 0) AS b FROM ledger_accounts WHERE owner_kind = 'system' AND system_code = 'fees' AND currency = 'USD'`)).rows[0].b);

describe('tips', () => {
  it('moves the exact amount, notifies, is idempotent and shows in the creator dashboard', async () => {
    kit.pinOk();
    kit.bigLimits();
    const creator = await kit.user();
    const fan = await funded(2_000);
    const id = await kit.post(creator, 'merci');
    const clientId = randomUUID();

    const res = await tipPost(fan, id, { clientId }).expect(201);
    expect(res.body).toMatchObject({ mode: 'sandbox', replayed: false, amountMinor: 500, currency: 'USD', balanceMinor: 1_500 });
    expect(await kit.balance(fan)).toBe(1_500);
    expect(await kit.balance(creator)).toBe(500);

    const again = await tipPost(fan, id, { clientId }).expect(200);
    expect(again.body).toMatchObject({ replayed: true, tipId: res.body.tipId });
    expect(await kit.balance(fan)).toBe(1_500);
    expect(await kit.balance(creator)).toBe(500);
    await tipPost(fan, id, { clientId, amountMinor: 600 }).expect(409);

    const notes = await ctx.http.get('/v1/notifications').set(bearer(creator.token)).expect(200);
    const note = notes.body.items.find((n: { title: string }) => n.title.startsWith('Pourboire'));
    expect(note.body).toContain('5.00 USD');
    expect(await ctx.sql.query(`SELECT 1 FROM journal_entries WHERE metadata->>'ref' = 'tip' AND metadata->>'postId' = $1`, [id])).toHaveProperty('rowCount', 1);

    const dash = await ctx.http.get('/v1/me/creator/overview').set(bearer(creator.token)).expect(200);
    expect(dash.body.tipsReceived).toEqual([{ currency: 'USD', totalMinor: 500, count: 1 }]);
    const hist = await ctx.http.get('/v1/wallet/transactions').set(bearer(creator.token)).expect(200);
    expect(hist.body.items[0]).toMatchObject({ kind: 'p2p', direction: 'in', amountMinor: 500, note: 'Pourboire' });
    expect((await ctx.app.get(WalletService).reconcile()).ok).toBe(true);
  });

  it('tips a user directly', async () => {
    kit.pinOk();
    kit.bigLimits();
    const creator = await kit.user();
    const fan = await funded(1_000);
    await tipUser(fan, creator.id, { amountMinor: 250 }).expect(201);
    expect(await kit.balance(creator)).toBe(250);
    await tipUser(fan, randomUUID()).expect(404);
    await tipUser(fan, 'nope').expect(404);
  });

  it('refuses a wrong or missing PIN without moving anything', async () => {
    kit.bigLimits();
    const creator = await kit.user();
    const fan = await funded(1_000);
    const id = await kit.post(creator, 'pin');
    const verify = vi.spyOn(ctx.app.get(PinVerifier), 'verify');
    verify.mockResolvedValue({ status: 'invalid', attemptsRemaining: 2 });
    const bad = await tipPost(fan, id).expect(403);
    expect(bad.body.error.details.reason).toBe('pin_invalid');
    verify.mockResolvedValue({ status: 'not_set' });
    expect((await tipPost(fan, id).expect(409)).body.error.details.reason).toBe('pin_not_set');
    expect(await kit.balance(fan)).toBe(1_000);
    expect(await kit.balance(creator)).toBe(0);
  });

  it('refuses self tips, blocked users, invisible posts, frozen accounts and insufficient funds', async () => {
    kit.pinOk();
    kit.bigLimits();
    const creator = await kit.user();
    const fan = await funded(1_000);
    const own = await kit.post(creator, 'a moi');
    await tipPost(creator, own).expect(400);
    await tipUser(creator, creator.id).expect(400);

    const priv = await kit.post(creator, 'prive', 'private');
    await tipPost(fan, priv).expect(404);
    await tipPost(fan, randomUUID()).expect(404);

    const open = await kit.post(creator, 'ouvert');
    await tipPost(fan, open, { amountMinor: 5_000 }).expect(409); // only 1000 left
    await kit.block(creator, fan);
    await tipPost(fan, open).expect(404);
    await tipUser(fan, creator.id).expect(404);
    await ctx.http.delete(`/v1/blocks/${creator.id === fan.id ? '' : fan.id}`).set(bearer(creator.token));

    const other = await kit.user();
    const post2 = await kit.post(other, 'gele');
    await tipPost(fan, post2).expect(201); // creates the creator account
    await ctx.sql.query(`UPDATE ledger_accounts SET status = 'frozen' WHERE user_id = $1`, [other.id]);
    await tipPost(fan, post2).expect(403);
    expect(await kit.balance(fan)).toBe(500);
  });

  it('caps one tip and the total per day', async () => {
    kit.pinOk();
    kit.bigLimits();
    const creator = await kit.user();
    const fan = await funded(30_000);
    const id = await kit.post(creator, 'plafonds');
    const over = await tipPost(fan, id, { amountMinor: 5_001 }).expect(400);
    expect(over.body.error.details[0].path).toBe('amountMinor');
    for (let i = 0; i < 4; i += 1) await tipPost(fan, id, { amountMinor: 5_000 }).expect(201);
    const limit = await tipPost(fan, id, { amountMinor: 100 }).expect(409);
    expect(limit.body.error.details.reason).toBe('tip_daily_limit');
    // CDF caps are scaled.
    await ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(fan.token)).send({ clientId: randomUUID(), amountMinor: 10_000_000, currency: 'CDF' }).expect(201);
    await tipPost(fan, id, { amountMinor: 5_000 * 2_800 + 1, currency: 'CDF' }).expect(400);
    await tipPost(fan, id, { amountMinor: 100_000, currency: 'CDF' }).expect(201);
    await tipPost(fan, id, { currency: 'EUR' }).expect(400);
  });

  it('never passes the daily cap with parallel tips', async () => {
    kit.pinOk();
    kit.bigLimits();
    const creator = await kit.user();
    const fan = await funded(60_000);
    const id = await kit.post(creator, 'concurrence');
    const results = await Promise.all(Array.from({ length: 8 }, () => tipPost(fan, id, { amountMinor: 5_000 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
    const total = await ctx.sql.query(`SELECT COALESCE(SUM(amount_minor), 0)::int AS t FROM journal_entries WHERE initiated_by = $1 AND metadata->>'ref' = 'tip'`, [fan.id]);
    expect(total.rows[0].t).toBe(20_000);
  });

  it('is private to authenticated callers and validates the body', async () => {
    await ctx.http.post(`/v1/posts/${randomUUID()}/tips`).send(tipBody()).expect(401);
    const fan = await kit.user();
    await ctx.http.post(`/v1/posts/${randomUUID()}/tips`).set(bearer(fan.token)).send({ amountMinor: 5 }).expect(400);
  });
});

describe('boosts', () => {
  it('answers parallel retries of the same clientId with the one boost, charged once', async () => {
    kit.pinOk();
    kit.bigLimits();
    const author = await funded(2_000);
    const id = await kit.post(author, 'retries');
    const clientId = randomUUID();
    const results = await Promise.all([1, 2, 3, 4].map(() => boost(author, id, { clientId })));
    expect(results.map((r) => r.status).filter((s) => s !== 201 && s !== 200)).toEqual([]);
    expect(new Set(results.map((r) => r.body.boost.id)).size).toBe(1);
    expect(await kit.balance(author)).toBe(1_500);
  });

  it('charges the fictitious budget to the platform account once, with an active boost per post at most', async () => {
    kit.pinOk();
    kit.bigLimits();
    const author = await funded(2_000);
    const id = await kit.post(author, 'a booster');
    const before = await systemBalance();
    const clientId = randomUUID();

    const res = await boost(author, id, { clientId }).expect(201);
    expect(res.body).toMatchObject({ mode: 'sandbox', replayed: false, balanceMinor: 1_500 });
    expect(res.body.boost).toMatchObject({ postId: id, status: 'active', budgetMinor: 500, currency: 'USD', impressions: 0 });
    const span = new Date(res.body.boost.endsAt).getTime() - new Date(res.body.boost.startsAt).getTime();
    expect(Math.round(span / 86_400_000)).toBe(3);
    expect(await kit.balance(author)).toBe(1_500);
    expect(await systemBalance()).toBe(before + 500);

    const again = await boost(author, id, { clientId }).expect(200);
    expect(again.body).toMatchObject({ replayed: true, balanceMinor: 1_500 });
    expect(again.body.boost.id).toBe(res.body.boost.id);
    await boost(author, id, { clientId, budgetMinor: 600 }).expect(409);
    expect((await boost(author, id).expect(409)).body.error.details.reason).toBe('boost_already_active');
    expect(await kit.balance(author)).toBe(1_500);
    expect((await ctx.app.get(WalletService).reconcile()).ok).toBe(true);

    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'creator.boost_created' AND actor_user_id = $1`, [author.id]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain('a booster');

    const dash = await ctx.http.get('/v1/me/creator/overview').set(bearer(author.token)).expect(200);
    expect(dash.body.boosts[0]).toMatchObject({ id: res.body.boost.id, status: 'active' });
  });

  it('is for the author, public posts, a valid budget and a correct PIN', async () => {
    kit.bigLimits();
    const pin = kit.pinOk();
    const author = await funded(2_000);
    const stranger = await kit.user();
    const id = await kit.post(author, 'regles');
    await boost(stranger, id).expect(403);
    await boost(stranger, randomUUID()).expect(404);
    const priv = await kit.post(author, 'prive', 'private');
    await boost(author, priv).expect(409);
    const hid = await kit.post(author, 'masquee');
    await ctx.sql.query(`UPDATE posts SET hidden = true WHERE id = $1`, [hid]);
    await boost(author, hid).expect(409);
    await boost(author, id, { budgetMinor: 99 }).expect(400);
    await boost(author, id, { budgetMinor: 10_001 }).expect(400);
    await boost(author, id, { days: 0 }).expect(400);
    await boost(author, id, { days: 15 }).expect(400);
    pin.mockResolvedValue({ status: 'invalid', attemptsRemaining: 1 });
    await boost(author, id).expect(403);
    expect(await kit.balance(author)).toBe(2_000);
    expect((await ctx.sql.query(`SELECT 1 FROM post_boosts WHERE post_id = $1`, [id])).rows).toHaveLength(0);
    pin.mockResolvedValue({ status: 'ok' });
    const poor = await kit.user();
    const pid = await kit.post(poor, 'sans fonds');
    expect((await boost(poor, pid).expect(409)).body.error.details.reason).toBe('insufficient_funds');
    expect((await ctx.sql.query(`SELECT 1 FROM post_boosts WHERE post_id = $1`, [pid])).rows).toHaveLength(0);
  });

  it('inserts a labelled sponsored post at most once per 10 posts, only for people who do not follow the author', async () => {
    kit.pinOk();
    kit.bigLimits();
    const poster = await kit.user();
    const viewer = await kit.user();
    await kit.follow(viewer, poster);
    const a = await funded(1_000);
    const b = await funded(1_000);
    const pa = await kit.post(a, 'sponso A');
    const pb = await kit.post(b, 'sponso B');
    await boost(a, pa).expect(201);
    await boost(b, pb).expect(201);
    await isolate([pa, pb]);
    for (let i = 0; i < 9; i += 1) await kit.post(poster, `organique ${i}`);

    const nine = (await feed(viewer).expect(200)).body.items;
    expect(nine).toHaveLength(9);
    expect(sponsoredIds(nine)).toEqual([]);
    expect(nine.every((p: { sponsored: boolean }) => p.sponsored === false)).toBe(true);

    for (let i = 9; i < 20; i += 1) await kit.post(poster, `organique ${i}`);
    const ten = (await feed(viewer, 10).expect(200)).body.items;
    expect(ten).toHaveLength(11);
    expect(sponsoredIds(ten)).toHaveLength(1);
    expect(ten[10].sponsored).toBe(true);
    expect([pa, pb]).toContain(ten[10].id);
    expect(ten.slice(0, 10).every((p: { sponsored: boolean }) => !p.sponsored)).toBe(true);

    const twenty = (await feed(viewer, 20).expect(200)).body.items;
    expect(twenty).toHaveLength(22);
    expect(sponsoredIds(twenty).sort()).toEqual([pa, pb].sort());
    const positions = twenty.map((p: { sponsored: boolean }, i: number) => (p.sponsored ? i : -1)).filter((i: number) => i >= 0);
    expect(positions).toEqual([10, 21]);

    // The author never sees their own boost; someone who follows the author already has the post.
    expect(sponsoredIds((await feed(a, 20).expect(200)).body.items)).toEqual([]);
    const fanOfA = await kit.user();
    await kit.follow(fanOfA, a);
    await kit.follow(fanOfA, poster);
    const fanFeed = (await feed(fanOfA, 50).expect(200)).body.items;
    expect(sponsoredIds(fanFeed)).toEqual([pb]);
    expect(fanFeed.filter((p: { id: string }) => p.id === pa)).toHaveLength(1);
  });

  it('never shows a hidden, deleted, no longer public, blocked, ended or rejected boosted post', async () => {
    kit.pinOk();
    kit.bigLimits();
    const poster = await kit.user();
    const viewer = await kit.user();
    await kit.follow(viewer, poster);
    for (let i = 0; i < 10; i += 1) await kit.post(poster, `base ${i}`);
    const authors: TU[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const u = await funded(1_000);
      const id = await kit.post(u, `candidat ${i}`);
      await boost(u, id).expect(201);
      authors.push(u);
      ids.push(id);
    }
    await isolate(ids);
    const stillSponsored = async () => sponsoredIds((await feed(viewer, 10).expect(200)).body.items);
    // 6 eligible: turn them off one after the other; when none is left the feed carries no sponsored post.
    await ctx.sql.query(`UPDATE posts SET hidden = true WHERE id = $1`, [ids[0]]);
    await ctx.http.delete(`/v1/posts/${ids[1]}`).set(bearer(authors[1]!.token)).expect(204);
    await ctx.http.patch(`/v1/posts/${ids[2]}`).set(bearer(authors[2]!.token)).send({ visibility: 'followers' }).expect(200);
    await kit.block(viewer, authors[3]!);
    await ctx.sql.query(`UPDATE post_boosts SET starts_at = now() - interval '2 minutes', ends_at = now() - interval '1 minute' WHERE post_id = $1`, [ids[4]]);
    const admin = await kit.user(['admin']);
    const list = await ctx.http.get('/v1/admin/boosts?status=active').set(bearer(admin.token)).expect(200);
    const target = list.body.items.find((x: { postId: string }) => x.postId === ids[5]);
    await ctx.http.post(`/v1/admin/boosts/${target.id}/reject`).set(bearer(admin.token)).expect(200);

    for (let i = 0; i < 10; i += 1) expect(await stillSponsored()).toEqual([]);
  });

  it('lets staff reject a running boost, refunds the budget and audits without content', async () => {
    kit.pinOk();
    kit.bigLimits();
    const author = await funded(1_000);
    const id = await kit.post(author, 'contenu litigieux');
    const made = await boost(author, id).expect(201);
    const mod = await kit.user(['moderator']);
    const plain = await kit.user();
    await ctx.http.post(`/v1/admin/boosts/${made.body.boost.id}/reject`).set(bearer(plain.token)).expect(403);
    await ctx.http.post(`/v1/admin/boosts/${randomUUID()}/reject`).set(bearer(mod.token)).expect(404);

    const res = await ctx.http.post(`/v1/admin/boosts/${made.body.boost.id}/reject`).set(bearer(mod.token)).expect(200);
    expect(res.body).toMatchObject({ status: 'rejected', userId: author.id, postId: id });
    expect(await kit.balance(author)).toBe(1_000);
    expect((await ctx.app.get(WalletService).reconcile()).ok).toBe(true);
    expect((await ctx.http.post(`/v1/admin/boosts/${made.body.boost.id}/reject`).set(bearer(mod.token)).expect(409)).body.error.details.reason).toBe('boost_not_active');
    const audit = await ctx.sql.query(`SELECT metadata, subject_user_id FROM audit_events WHERE action = 'creator.boost_rejected' AND subject_user_id = $1`, [author.id]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain('litigieux');
    expect(audit.rows[0].subject_user_id).toBe(author.id);
    const notes = await ctx.http.get('/v1/notifications').set(bearer(author.token)).expect(200);
    expect(notes.body.items.some((n: { title: string }) => n.title.includes('sponsorisée refusée'))).toBe(true);

    // A rejected boost frees the post for a new one.
    await boost(author, id).expect(201);
  });

  it('refuses to reject a boost whose run already ended (no refund of consumed budget)', async () => {
    kit.pinOk();
    kit.bigLimits();
    const author = await funded(1_000);
    const id = await kit.post(author, 'termine');
    const made = await boost(author, id).expect(201);
    await ctx.sql.query("UPDATE post_boosts SET starts_at = now() - interval '3 days', ends_at = now() - interval '1 day' WHERE id = $1", [made.body.boost.id]);
    const mod = await kit.user(['moderator']);
    const res = await ctx.http.post(`/v1/admin/boosts/${made.body.boost.id}/reject`).set(bearer(mod.token)).expect(409);
    expect(res.body.error.details.reason).toBe('boost_not_active');
    expect(await kit.balance(author)).toBe(500); // the 500 budget was paid and is not given back
  });

  it('exports boosts and tips with the account and removes them with the posts', async () => {
    kit.pinOk();
    kit.bigLimits();
    const author = await funded(2_000);
    const fan = await funded(1_000);
    const id = await kit.post(author, 'export');
    await boost(author, id).expect(201);
    await tipPost(fan, id).expect(201);
    const mine = await ctx.http.get('/v1/me/export').set(bearer(author.token)).expect(200);
    expect(mine.body.creator.boosts).toHaveLength(1);
    expect(mine.body.creator.boosts[0]).toMatchObject({ postId: id, status: 'active', budgetMinor: 500, currency: 'USD' });
    expect(mine.body.creator.tips).toEqual([expect.objectContaining({ direction: 'received', postId: id, amountMinor: 500 })]);
    expect(JSON.stringify(mine.body.creator)).not.toContain(fan.id);
    const theirs = await ctx.http.get('/v1/me/export').set(bearer(fan.token)).expect(200);
    expect(theirs.body.creator.tips).toEqual([expect.objectContaining({ direction: 'sent', amountMinor: 500 })]);

    await ctx.sql.query(`DELETE FROM posts WHERE id = $1`, [id]);
    expect((await ctx.sql.query(`SELECT 1 FROM post_boosts WHERE post_id = $1`, [id])).rows).toHaveLength(0);
    await ctx.app.get(MaintenanceService).runOnce();
  });
});
