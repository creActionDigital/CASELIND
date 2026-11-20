import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ENV, type Env } from '../src/config/env.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

/** Double validation of sensitive administrator operations (CDC §17/§26). */
let ctx: TestContext;
let env: Env;
beforeAll(async () => {
  ctx = await createTestContext();
  env = ctx.app.get<Env>(ENV);
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  env.ADMIN_DUAL_APPROVAL = undefined;
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
const admin = () => user(['user', 'admin']);
const on = () => {
  env.ADMIN_DUAL_APPROVAL = 'true';
};
const put = (u: TU, path: string, body: Record<string, unknown>) => ctx.http.put(`/v1${path}`).set(bearer(u.token)).send(body);
const post = (u: TU, path: string, body: Record<string, unknown> = {}) => ctx.http.post(`/v1${path}`).set(bearer(u.token)).send(body);
const decide = (u: TU, id: string, what: 'approve' | 'reject' | 'cancel') => post(u, `/admin/approvals/${id}/${what}`);
const row = async (id: string) => (await ctx.sql.query('SELECT * FROM admin_approvals WHERE id = $1', [id])).rows[0];
const flagEnabled = async (key: string) => (await ctx.sql.query('SELECT enabled FROM feature_flags WHERE key = $1', [key])).rows[0].enabled as boolean;
const rolesOf = async (id: string) => (await ctx.sql.query('SELECT roles FROM users WHERE id = $1', [id])).rows[0].roles as string[];
const countAudit = async (action: string, filter = '') => Number((await ctx.sql.query(`SELECT count(*) FROM audit_events WHERE action = $1 ${filter}`, [action])).rows[0].count);

async function ledgerAccount(u: TU): Promise<string> {
  await ctx.http.post('/v1/wallet/sandbox/topup').set(bearer(u.token)).send({ clientId: randomUUID(), amountMinor: 1_000, currency: 'USD' }).expect(201);
  return (await ctx.sql.query(`SELECT id FROM ledger_accounts WHERE user_id = $1 AND currency = 'USD'`, [u.id])).rows[0].id;
}

describe('mode inactive (default outside production)', () => {
  it('leaves every sensitive route unchanged and creates no request', async () => {
    const a = await admin();
    const u = await user();
    expect(await ctx.http.get('/v1/admin/approvals').set(bearer(a.token)).expect(200).then((r) => r.body.items)).toEqual([]);

    await put(a, '/admin/flags/betting', { enabled: true, confirmRegulated: true }).expect(200);
    expect(await flagEnabled('betting')).toBe(true);
    await put(a, '/admin/flags/betting', { enabled: false }).expect(200);

    await post(a, `/admin/users/${u.id}/platform-roles`, { role: 'moderator', reason: 'equipe moderation' }).expect(204);
    expect(await rolesOf(u.id)).toContain('moderator');
    await put(a, `/admin/users/${u.id}/status`, { status: 'suspended', reason: 'abus repete' }).expect(204);

    const acc = await ledgerAccount(await user());
    const frozen = await post(a, `/admin/ledger/accounts/${acc}/freeze`).expect(200);
    expect(frozen.body.status).toBe('frozen');
    expect(Number((await ctx.sql.query('SELECT count(*) FROM admin_approvals')).rows[0].count)).toBe(0);
  });

  it('defaults to active in production only, and the variable overrides', async () => {
    const saved = env.NODE_ENV;
    const a = await admin();
    try {
      env.NODE_ENV = 'production';
      const r = await put(a, '/admin/flags/betting', { enabled: true, confirmRegulated: true });
      expect(r.status).toBe(202);
      env.ADMIN_DUAL_APPROVAL = 'false';
      await put(a, '/admin/flags/betting', { enabled: true, confirmRegulated: true }).expect(200);
      await put(a, '/admin/flags/betting', { enabled: false }).expect(200);
    } finally {
      env.NODE_ENV = saved;
    }
  });
});

describe('mode active', () => {
  it('flag: pending request, no self-approval, second admin executes it exactly once', async () => {
    on();
    const [a, b, plain] = [await admin(), await admin(), await user()];
    const r = await put(a, '/admin/flags/trading.live', { enabled: true, confirmRegulated: true, description: 'Trading reel' });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ approvalId: expect.any(String), status: 'pending' });
    const id = r.body.approvalId as string;
    expect(await flagEnabled('trading.live')).toBe(false);

    // the same request again is the same approval
    expect((await put(a, '/admin/flags/trading.live', { enabled: true, confirmRegulated: true, description: 'Trading reel' })).body.approvalId).toBe(id);
    // a non-regulated flag is not guarded
    await put(a, '/admin/flags/social.stories', { enabled: false }).expect(200);
    await put(a, '/admin/flags/social.stories', { enabled: true }).expect(200);

    expect((await decide(a, id, 'approve')).status).toBe(403); // own request
    expect((await decide(a, id, 'reject')).status).toBe(403);
    expect((await decide(plain, id, 'approve')).status).toBe(403); // not an administrator
    expect((await decide(b, randomUUID(), 'approve')).status).toBe(404);
    expect((await decide(b, 'pas-un-uuid', 'approve')).status).toBe(404);
    expect(await flagEnabled('trading.live')).toBe(false);

    const ok = await decide(b, id, 'approve').expect(200);
    expect(ok.body).toMatchObject({ id, kind: 'flag.regulated.change', status: 'executed', requestedBy: a.id, decidedBy: b.id });
    expect(await flagEnabled('trading.live')).toBe(true);
    expect((await ctx.sql.query(`SELECT updated_by FROM feature_flags WHERE key = 'trading.live'`)).rows[0].updated_by).toBe(a.id);

    expect((await decide(b, id, 'approve')).status).toBe(409); // idempotent: nothing runs twice
    expect(await countAudit('admin.flag_updated', `AND metadata->>'key' = 'trading.live'`)).toBe(1);
    expect(await countAudit('admin.approval_executed')).toBeGreaterThanOrEqual(1);

    const dbRow = await row(id);
    expect(dbRow.decided_by).toBe(b.id);
    expect(dbRow.executed_at).not.toBeNull();
    // turning it off is guarded too, and so is a no-op toggle: not
    expect((await put(a, '/admin/flags/trading.live', { enabled: true, confirmRegulated: true })).status).toBe(200);
    expect((await put(a, '/admin/flags/trading.live', { enabled: false })).status).toBe(202);
  });

  it('reject, cancel, list and rights', async () => {
    on();
    const [a, b, plain] = [await admin(), await admin(), await user()];
    const acc = await ledgerAccount(await user());
    const pend = await post(a, `/admin/ledger/accounts/${acc}/freeze`).expect(202);
    const id = pend.body.approvalId as string;
    expect((await post(a, '/admin/ledger/accounts/00000000-0000-4000-8000-000000000000/freeze')).status).toBe(404); // nothing queued for nothing

    const rej = await decide(b, id, 'reject').expect(200);
    expect(rej.body).toMatchObject({ status: 'rejected', decidedBy: b.id });
    expect((await ctx.sql.query('SELECT status FROM ledger_accounts WHERE id = $1', [acc])).rows[0].status).toBe('active');
    expect((await decide(b, id, 'approve')).status).toBe(409); // already decided

    const second = (await post(a, `/admin/ledger/accounts/${acc}/freeze`).expect(202)).body.approvalId as string;
    expect((await decide(b, second, 'cancel')).status).toBe(403); // only the author
    expect((await decide(a, second, 'cancel').expect(200)).body.status).toBe('cancelled');
    expect((await decide(b, second, 'approve')).status).toBe(409);

    const pending = await ctx.http.get('/v1/admin/approvals?status=pending').set(bearer(b.token)).expect(200);
    expect(pending.body.items.map((x: { id: string }) => x.id)).not.toContain(id);
    const rejected = await ctx.http.get('/v1/admin/approvals?status=rejected').set(bearer(b.token)).expect(200);
    expect(rejected.body.items[0]).toMatchObject({ id, kind: 'ledger.account.freeze', subjectId: acc, payload: { frozen: true }, status: 'rejected' });
    await ctx.http.get('/v1/admin/approvals?status=nope').set(bearer(b.token)).expect(400);
    await ctx.http.get('/v1/admin/approvals').set(bearer(plain.token)).expect(403);
    await ctx.http.get('/v1/admin/approvals').expect(401);
    await ctx.http.post(`/v1/admin/approvals/${id}/approve`).expect(401);
  });

  it('ledger freeze executes on approval', async () => {
    on();
    const [a, b] = [await admin(), await admin()];
    const acc = await ledgerAccount(await user());
    const id = (await post(a, `/admin/ledger/accounts/${acc}/freeze`).expect(202)).body.approvalId as string;
    await decide(b, id, 'approve').expect(200);
    expect((await ctx.sql.query('SELECT status FROM ledger_accounts WHERE id = $1', [acc])).rows[0].status).toBe('frozen');
    const un = (await post(a, `/admin/ledger/accounts/${acc}/unfreeze`).expect(202)).body.approvalId as string;
    await decide(b, un, 'approve').expect(200);
    expect((await ctx.sql.query('SELECT status FROM ledger_accounts WHERE id = $1', [acc])).rows[0].status).toBe('active');
  });

  it('platform role: own role refused, request approved by a second administrator, a failing run stays pending', async () => {
    on();
    const [a, b, target] = [await admin(), await admin(), await user()];
    await post(a, `/admin/users/${a.id}/platform-roles`, { role: 'support', reason: 'moi-meme' }).expect(409);
    await post(a, `/admin/users/${randomUUID()}/platform-roles`, { role: 'support', reason: 'inconnu' }).expect(404);
    await post(a, `/admin/users/${target.id}/platform-roles`, { role: 'root', reason: 'invalide' }).expect(400);

    const id = (await post(a, `/admin/users/${target.id}/platform-roles`, { role: 'moderator', reason: 'renfort equipe' }).expect(202)).body.approvalId as string;
    expect(await rolesOf(target.id)).toEqual(['user']);
    await decide(b, id, 'approve').expect(200);
    expect(await rolesOf(target.id)).toContain('moderator');
    expect(await countAudit('admin.platform_role_granted', `AND subject_user_id = '${target.id}'`)).toBe(1);

    // the situation changed meanwhile: the operation fails, nothing is half done, the request stays pending
    const other = await user();
    const id2 = (await post(a, `/admin/users/${other.id}/platform-roles`, { role: 'support', reason: 'renfort' }).expect(202)).body.approvalId as string;
    await ctx.sql.query(`UPDATE users SET roles = ARRAY['user','support'] WHERE id = $1`, [other.id]);
    expect((await decide(b, id2, 'approve')).status).toBe(409);
    expect((await row(id2)).status).toBe('pending');
  });

  it('suspending a member of staff is guarded, other suspensions are not', async () => {
    on();
    const [a, b, staff, plain, peer] = [await admin(), await admin(), await user(['user', 'moderator']), await user(), await admin()];
    await put(a, `/admin/users/${plain.id}/status`, { status: 'suspended', reason: 'compte ordinaire' }).expect(204);
    await put(a, `/admin/users/${peer.id}/status`, { status: 'suspended', reason: 'autre admin' }).expect(409);
    const r = await put(a, `/admin/users/${staff.id}/status`, { status: 'suspended', reason: 'comportement grave' });
    expect(r.status).toBe(202);
    expect((await ctx.sql.query('SELECT status FROM users WHERE id = $1', [staff.id])).rows[0].status).toBe('active');
    await decide(b, r.body.approvalId, 'approve').expect(200);
    expect((await ctx.sql.query('SELECT status FROM users WHERE id = $1', [staff.id])).rows[0].status).toBe('suspended');
    const audits = await ctx.sql.query(`SELECT metadata::text AS md FROM audit_events WHERE action = 'admin.user_status' AND subject_user_id = $1`, [staff.id]);
    expect(audits.rows).toHaveLength(1);
  });

  it('an organisation commission goes through the double validation; the targeted admin cannot decide a request about themself', async () => {
    on();
    const [a, b, staff] = [await admin(), await admin(), await admin()];
    const owner = await user();
    const org = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `appr-${Date.now().toString(36)}`, name: 'Boutique test', kind: 'shop' }).expect(201);
    const orgId = org.body.id as string;
    const r = await put(a, `/admin/orgs/${orgId}/commission`, { bps: 500, reason: 'accord commercial' });
    expect(r.status).toBe(202);
    const bps = async () => (await ctx.sql.query('SELECT commission_bps FROM organizations WHERE id = $1', [orgId])).rows[0].commission_bps;
    expect(await bps()).toBeNull();
    await decide(b, r.body.approvalId, 'approve').expect(200);
    expect(await bps()).toBe(500);

    const s = await post(a, `/admin/users/${staff.id}/platform-roles`, { role: 'support', reason: 'renfort equipe' });
    expect(s.status).toBe(202);
    expect((await decide(staff, s.body.approvalId, 'approve')).status).toBe(403);
    expect((await decide(staff, s.body.approvalId, 'reject')).status).toBe(403);
    await decide(b, s.body.approvalId, 'approve').expect(200);
  });

  it('a request expires after 24 hours', async () => {
    on();
    const [a, b] = [await admin(), await admin()];
    const id = (await put(a, '/admin/flags/gifts.red_packets', { enabled: true, confirmRegulated: true }).expect(202)).body.approvalId as string;
    const dbRow = await row(id);
    expect(new Date(dbRow.expires_at).getTime() - new Date(dbRow.created_at).getTime()).toBe(24 * 3_600_000);
    await ctx.sql.query(`UPDATE admin_approvals SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    const r = await decide(b, id, 'approve');
    expect(r.status).toBe(409);
    expect(r.body.error.details).toMatchObject({ reason: 'expired' });
    expect((await row(id)).status).toBe('expired');
    expect(await flagEnabled('gifts.red_packets')).toBe(false);
    expect((await ctx.http.get('/v1/admin/approvals?status=expired').set(bearer(b.token)).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(id);

    // Listing is read-only: it shows the effective status and leaves the write to the maintenance run.
    const id2 = (await put(a, '/admin/flags/csl_coins', { enabled: true, confirmRegulated: true }).expect(202)).body.approvalId as string;
    await ctx.sql.query(`UPDATE admin_approvals SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id2]);
    const listed = (await ctx.http.get('/v1/admin/approvals').set(bearer(b.token)).expect(200)).body.items as { id: string; status: string }[];
    expect(listed.find((x) => x.id === id2)?.status).toBe('expired');
    expect((await ctx.http.get('/v1/admin/approvals?status=pending').set(bearer(b.token)).expect(200)).body.items.map((x: { id: string }) => x.id)).not.toContain(id2);
    expect((await row(id2)).status).toBe('pending');
    await ctx.app.get(MaintenanceService).runOnce();
    expect((await row(id2)).status).toBe('expired');
  });

  it('notifies the other administrators on creation and the author on decision, without content; audit without payload', async () => {
    on();
    const [a, b, plain] = [await admin(), await admin(), await user()];
    const id = (await put(a, '/admin/flags/wallet.p2p_transfer', { enabled: true, confirmRegulated: true, description: 'Texte libre du reglage' }).expect(202)).body.approvalId as string;
    const notifs = async (uid: string) => (await ctx.sql.query(`SELECT category, title, body, data FROM notifications WHERE user_id = $1 AND data->>'approvalId' = $2`, [uid, id])).rows;
    expect(await notifs(b.id)).toHaveLength(1);
    expect((await notifs(b.id))[0]).toMatchObject({ category: 'system', data: { approvalId: id, kind: 'flag.regulated.change' } });
    expect(await notifs(a.id)).toHaveLength(0);
    expect(await notifs(plain.id)).toHaveLength(0);

    await decide(b, id, 'approve').expect(200);
    const mine = await notifs(a.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].data).toMatchObject({ decision: 'approved' });

    const audits = await ctx.sql.query(`SELECT action, metadata::text AS md FROM audit_events WHERE action LIKE 'admin.approval_%' AND metadata->>'approvalId' = $1`, [id]);
    expect(audits.rows.map((r) => r.action).sort()).toEqual(['admin.approval_decided', 'admin.approval_executed', 'admin.approval_requested']);
    expect(JSON.stringify(audits.rows)).not.toContain('Texte libre');
    expect(JSON.stringify(audits.rows)).not.toContain('confirmRegulated');
  });
});

describe('closing the gaps found by the review', () => {
  it('a country/role scope change on a regulated flag is guarded like a switch', async () => {
    on();
    const [a, b] = [await admin(), await admin()];
    const r = await put(a, '/admin/flags/trading.live', { allowedCountries: ['CD'], confirmRegulated: true });
    expect(r.status).toBe(202);
    const dbRow = await row(r.body.approvalId as string);
    expect(dbRow.payload).toMatchObject({ key: 'trading.live', patch: { allowedCountries: ['CD'] } });
    expect((await decide(b, r.body.approvalId as string, 'reject')).status).toBe(200);
  });

  it('refuses to execute a request whose author is no longer an active administrator', async () => {
    on();
    const [a, b] = [await admin(), await admin()];
    const r = await put(a, '/admin/flags/trading.live', { enabled: !(await flagEnabled('trading.live')), confirmRegulated: true });
    expect(r.status).toBe(202);
    const before = await flagEnabled('trading.live');
    await ctx.sql.query(`UPDATE users SET roles = '{user}'::text[] WHERE id = $1`, [a.id]);
    const res = await decide(b, r.body.approvalId as string, 'approve');
    expect(res.status).toBe(409);
    expect(res.body.error.details).toMatchObject({ reason: 'requester_not_admin' });
    expect(await flagEnabled('trading.live')).toBe(before);
  });
});
