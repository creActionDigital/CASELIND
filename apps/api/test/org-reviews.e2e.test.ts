import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  handle: string;
}

async function user(roles?: string[]): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  if (roles) await ctx.sql.query('UPDATE users SET roles = $1::text[] WHERE id = $2', [roles, me.body.id]);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}

let n = 0;
async function createOrg(owner: TU, extra: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const slug = `avis-${Date.now().toString(36)}-${++n}`;
  const res = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug, name: 'Boutique Avis', kind: 'shop', ...extra }).expect(201);
  return { id: res.body.id, slug: res.body.slug };
}

async function addMember(orgId: string, owner: TU, m: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(owner.token)).send({ handle: m.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(m.token)).expect(200);
}

/** An order of the buyer at the organisation, inserted directly: the checkout flow is covered by commerce tests. */
async function order(buyer: TU, orgId: string, status = 'delivered'): Promise<void> {
  await ctx.sql.query(
    `INSERT INTO orders (number, buyer_id, org_id, client_id, currency, status, subtotal_minor, total_minor, payment_method)
     VALUES ($1, $2, $3, $4, 'USD', $5, 100, 100, 'cash_on_delivery')`,
    [`T-${randomUUID()}`, buyer.id, orgId, randomUUID(), status],
  );
}

const put = (u: TU, orgId: string, body: Record<string, unknown>) => ctx.http.put(`/v1/me/org-reviews/${orgId}`).set(bearer(u.token)).send(body);
const pub = (slug: string, q = '', u?: TU) => {
  const r = ctx.http.get(`/v1/public/orgs/${slug}/reviews${q}`);
  return u ? r.set(bearer(u.token)) : r;
};
const store = (slug: string, u?: TU) => {
  const r = ctx.http.get(`/v1/public/orgs/${slug}`);
  return u ? r.set(bearer(u.token)) : r;
};

describe('org reviews', () => {
  it('lets only the buyer of a delivered order review, once, and edit or delete', async () => {
    const owner = await user();
    const buyer = await user();
    const org = await createOrg(owner);

    expect((await ctx.http.get(`/v1/me/org-reviews/${org.id}`).set(bearer(buyer.token)).expect(200)).body).toMatchObject({ canReview: false, review: null });
    expect((await put(buyer, org.id, { rating: 5 }).expect(403)).body.error.details.reason).toBe('not_purchased');
    await order(buyer, org.id, 'shipped');
    await put(buyer, org.id, { rating: 5 }).expect(403);
    await order(buyer, org.id);
    expect((await ctx.http.get(`/v1/me/org-reviews/${org.id}`).set(bearer(buyer.token)).expect(200)).body.canReview).toBe(true);

    await put(buyer, org.id, { rating: 0 }).expect(400);
    await put(buyer, org.id, { rating: 6 }).expect(400);
    await put(buyer, org.id, { rating: 4, body: 'x'.repeat(501) }).expect(400);
    const first = (await put(buyer, org.id, { rating: 4, body: '  Service SECRETAVIS rapide  ' }).expect(200)).body;
    expect(first).toMatchObject({ rating: 4, body: 'Service SECRETAVIS rapide', reply: null, author: { userId: buyer.id } });
    // A second PUT edits the same review (one per organisation and account).
    const edited = (await put(buyer, org.id, { rating: 2 }).expect(200)).body;
    expect(edited).toMatchObject({ id: first.id, rating: 2, body: null });
    expect((await ctx.sql.query(`SELECT count(*)::int AS n FROM org_reviews WHERE org_id = $1`, [org.id])).rows[0].n).toBe(1);

    const mine = (await ctx.http.get(`/v1/me/org-reviews/${org.id}`).set(bearer(buyer.token)).expect(200)).body;
    expect(mine).toMatchObject({ canReview: true, hidden: false, review: { id: first.id } });

    await ctx.http.delete(`/v1/me/org-reviews/${org.id}`).set(bearer(buyer.token)).expect(204);
    await ctx.http.delete(`/v1/me/org-reviews/${org.id}`).set(bearer(buyer.token)).expect(404);
    await ctx.http.delete(`/v1/me/org-reviews/pas-un-uuid`).set(bearer(buyer.token)).expect(404);

    const { rows } = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE metadata->>'orgId' = $1 AND action LIKE 'org.review_%' ORDER BY id`, [org.id]);
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['org.review_saved', 'org.review_saved', 'org.review_deleted']);
    expect(JSON.stringify(rows)).not.toContain('SECRETAVIS');
    expect(rows[0].metadata).toMatchObject({ reviewId: first.id, rating: 4 });
  });

  it('refuses a member of the organisation and unknown, private or malformed organisations', async () => {
    const owner = await user();
    const priv = await createOrg(owner, { visibility: 'private' });
    const org = await createOrg(owner);
    await order(owner, org.id);
    expect((await put(owner, org.id, { rating: 5 }).expect(403)).body.error.details.reason).toBe('member');
    const buyer = await user();
    await order(buyer, priv.id);
    await put(buyer, priv.id, { rating: 5 }).expect(404);
    await put(buyer, randomUUID(), { rating: 5 }).expect(404);
    await put(buyer, 'pas-un-uuid', { rating: 5 }).expect(404);
    await ctx.http.put(`/v1/me/org-reviews/${org.id}`).send({ rating: 5 }).expect(401);
  });

  it('lists publicly with a cursor, adds the average to the storefront and excludes hidden reviews', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    expect((await store(org.slug).expect(200)).body.rating).toBeNull();
    const buyers = [await user(), await user(), await user()];
    const ratings = [5, 4, 2];
    for (const [i, b] of buyers.entries()) {
      await order(b, org.id);
      await put(b, org.id, { rating: ratings[i]!, body: `avis ${i}` }).expect(200);
      // Distinct creation dates so the order is stable.
      await ctx.sql.query(`UPDATE org_reviews SET created_at = now() - ($1 || ' minutes')::interval WHERE org_id = $2 AND user_id = $3`, [String(10 - i), org.id, b.id]);
    }
    expect((await store(org.slug).expect(200)).body.rating).toEqual({ average: 3.67, count: 3 });

    const all = (await pub(org.slug).expect(200)).body;
    expect(all.items.map((i: { body: string }) => i.body)).toEqual(['avis 2', 'avis 1', 'avis 0']);
    expect(all.items[0].author).toMatchObject({ userId: buyers[2]!.id });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await pub(org.slug, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      seen.push(...page.body.items.map((i) => i.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.items.map((i: { id: string }) => i.id));
    await pub(org.slug, '?cursor=garbage').expect(400);

    await ctx.sql.query(`UPDATE org_reviews SET hidden = true WHERE id = $1`, [all.items[0].id]);
    expect((await store(org.slug).expect(200)).body.rating).toEqual({ average: 4.5, count: 2 });
    expect((await pub(org.slug).expect(200)).body.items).toHaveLength(2);

    const priv = await createOrg(owner, { visibility: 'private' });
    await pub(priv.slug).expect(404);
    await pub('inconnue-zzz').expect(404);
  });

  it('skips the authors blocked with the reader when a token is sent', async () => {
    const owner = await user();
    const org = await createOrg(owner);
    const [a, b, reader] = [await user(), await user(), await user()];
    for (const u of [a, b]) {
      await order(u, org.id);
      await put(u, org.id, { rating: 5 }).expect(200);
    }
    expect((await pub(org.slug, '', reader).expect(200)).body.items).toHaveLength(2);
    await ctx.http.put(`/v1/blocks/${a.id}`).set(bearer(reader.token)).expect(204);
    expect((await pub(org.slug, '', reader).expect(200)).body.items.map((i: { author: { userId: string } }) => i.author.userId)).toEqual([b.id]);
    // Blocked the other way round: the blocked author does not see the blocker's review either.
    await ctx.http.put(`/v1/blocks/${reader.id}`).set(bearer(b.token)).expect(204);
    expect((await pub(org.slug, '', reader).expect(200)).body.items).toHaveLength(0);
    // Anonymous readers see everything; the average is the same for everyone.
    expect((await pub(org.slug).expect(200)).body.items).toHaveLength(2);
    expect((await store(org.slug, reader).expect(200)).body.rating.count).toBe(2);
  });

  it('lets the organisation reply (orders.manage), notifies the author and lists for staff', async () => {
    const owner = await user();
    const manager = await user();
    const employee = await user();
    const stranger = await user();
    const buyer = await user();
    const org = await createOrg(owner);
    await addMember(org.id, owner, manager, 'manager');
    await addMember(org.id, owner, employee, 'employee');
    await order(buyer, org.id);
    const review = (await put(buyer, org.id, { rating: 3, body: 'Moyen' }).expect(200)).body;
    const reply = (id: string, u: TU, body = 'Merci REPONSESECRETE') => ctx.http.post(`/v1/orgs/${org.id}/store-reviews/${id}/reply`).set(bearer(u.token)).send({ body });

    await reply(review.id, employee).expect(403);
    await reply(review.id, stranger).expect(404);
    await reply(review.id, manager, '').expect(400);
    await reply(randomUUID(), manager).expect(404);
    await reply('pas-un-uuid', manager).expect(404);
    expect((await ctx.http.get(`/v1/orgs/${org.id}/store-reviews?status=unanswered`).set(bearer(employee.token)).expect(200)).body.items).toHaveLength(1);
    const replied = (await reply(review.id, manager).expect(200)).body;
    expect(replied.reply).toMatchObject({ body: 'Merci REPONSESECRETE' });
    expect((await ctx.http.get(`/v1/orgs/${org.id}/store-reviews?status=unanswered`).set(bearer(owner.token)).expect(200)).body.items).toHaveLength(0);
    expect((await ctx.http.get(`/v1/orgs/${org.id}/store-reviews`).set(bearer(owner.token)).expect(200)).body.items).toHaveLength(1);
    await ctx.http.get(`/v1/orgs/${org.id}/store-reviews`).set(bearer(stranger.token)).expect(404);
    expect((await pub(org.slug).expect(200)).body.items[0].reply.body).toBe('Merci REPONSESECRETE');

    const notif = await ctx.sql.query(`SELECT title, body FROM notifications WHERE user_id = $1`, [buyer.id]);
    expect(notif.rows).toHaveLength(1);
    expect(JSON.stringify(notif.rows)).not.toContain('REPONSESECRETE');
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'org.review_replied' AND metadata->>'orgId' = $1`, [org.id]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain('REPONSESECRETE');
  });

  it('can be reported and hidden by a moderator; a hidden review cannot be edited, deleted or answered', async () => {
    const owner = await user();
    const buyer = await user();
    const reader = await user();
    const mod = await user(['user', 'moderator']);
    const org = await createOrg(owner);
    await order(buyer, org.id);
    const review = (await put(buyer, org.id, { rating: 1, body: 'Spam' }).expect(200)).body;
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'org_review', targetId: review.id, reason: 'spam' }).expect(201);
    await ctx.http.post('/v1/admin/moderation/actions').set(bearer(mod.token)).send({ targetType: 'org_review', targetId: review.id, action: 'hide' }).expect(200);
    expect((await pub(org.slug).expect(200)).body.items).toHaveLength(0);
    expect((await store(org.slug).expect(200)).body.rating).toBeNull();
    // Outsiders can no longer report it; the author and the organisation still can see it.
    await ctx.http.post('/v1/reports').set(bearer(reader.token)).send({ targetType: 'org_review', targetId: review.id, reason: 'spam' }).expect(404);
    expect((await put(buyer, org.id, { rating: 5 }).expect(409)).body.error.details.reason).toBe('moderated');
    await ctx.http.delete(`/v1/me/org-reviews/${org.id}`).set(bearer(buyer.token)).expect(409);
    await ctx.http.post(`/v1/orgs/${org.id}/store-reviews/${review.id}/reply`).set(bearer(owner.token)).send({ body: 'Non' }).expect(404);
    expect((await ctx.http.get(`/v1/me/org-reviews/${org.id}`).set(bearer(buyer.token)).expect(200)).body).toMatchObject({ hidden: true });
  });

  it('exports the own reviews with the organisation reply', async () => {
    const owner = await user();
    const buyer = await user();
    const org = await createOrg(owner);
    await order(buyer, org.id);
    const review = (await put(buyer, org.id, { rating: 4, body: 'Bien' }).expect(200)).body;
    await ctx.http.post(`/v1/orgs/${org.id}/store-reviews/${review.id}/reply`).set(bearer(owner.token)).send({ body: 'Merci' }).expect(200);
    const exp = (await ctx.http.get('/v1/me/export').set(bearer(buyer.token)).expect(200)).body;
    expect(exp.orgFeedback.reviews).toEqual([expect.objectContaining({ id: review.id, orgName: 'Boutique Avis', rating: 4, body: 'Bien', reply: 'Merci' })]);
    expect((await ctx.http.get('/v1/me/export').set(bearer(owner.token)).expect(200)).body.orgFeedback.reviews).toEqual([]);
  });
});
