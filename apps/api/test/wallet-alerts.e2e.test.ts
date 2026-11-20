import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { bearer, createTestContext, type TestContext } from './helpers.js';
import { financeKit, type FU } from './wallet-finance-helpers.js';

/** Anomaly alerts (information only): rules fire after a send, nothing is ever blocked. */
let ctx: TestContext;
let k: ReturnType<typeof financeKit>;

beforeAll(async () => {
  ctx = await createTestContext();
  k = financeKit(ctx);
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const send = (from: FU, to: FU, amountMinor: number) =>
  k.post(from, '/v1/wallet/transfers', { clientId: randomUUID(), toHandle: to.handle, amountMinor, currency: 'USD', pin: '1234' });
const alertsOf = async (u: FU) => (await k.get(u, '/v1/wallet/alerts').expect(200)).body.items as Array<{ id: string; rule: string; severity: string; status: string; reported: boolean; transferId: string }>;

describe('wallet anomaly alerts', () => {
  it('amount above 5 x the median of the last sends raises amount_outlier, without blocking the transfer', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 5000);
    for (let i = 0; i < 5; i++) await send(a, b, 100).expect(201);
    expect(await alertsOf(a)).toEqual([]);
    const big = await send(a, b, 600).expect(201); // 600 > 5 x 100
    const alerts = await alertsOf(a);
    expect(alerts.map((x) => x.rule)).toContain('amount_outlier');
    expect(alerts.find((x) => x.rule === 'amount_outlier')).toMatchObject({ severity: 'warn', status: 'open', reported: false, transferId: big.body.transferId });
    expect(await k.balance(a)).toBe(5000 - 500 - 600); // the money did move
    const notes = await ctx.sql.query(`SELECT title, body FROM notifications WHERE user_id = $1 AND category = 'security'`, [a.id]);
    expect(notes.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(notes.rows)).toContain('mode test');
    expect(JSON.stringify(notes.rows)).not.toContain('600');
  });

  it('more than 5 sends in 10 minutes raises one burst alert (not one per send)', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 5000);
    for (let i = 0; i < 8; i++) await send(a, b, 10 + i).expect(201);
    const burst = (await alertsOf(a)).filter((x) => x.rule === 'burst');
    expect(burst).toHaveLength(1);
  });

  it('a first send above 50 % of the daily limit raises new_recipient_large; the second one does not', async () => {
    k.pinOk();
    k.limits({ maxDailyOutgoingMinor: 1000 });
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 5000);
    await send(a, b, 600).expect(201);
    expect((await alertsOf(a)).map((x) => x.rule)).toEqual(['new_recipient_large']);
    await send(a, b, 100).expect(201);
    expect(await alertsOf(a)).toHaveLength(1);
  });

  it('more than 8 distinct recipients within an hour raises many_recipients (high)', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    await k.topup(a, 5000);
    for (let i = 0; i < 9; i++) await send(a, await k.user(), 10).expect(201);
    const many = (await alertsOf(a)).filter((x) => x.rule === 'many_recipients');
    expect(many).toHaveLength(1);
    expect(many[0]!.severity).toBe('high');
  });

  it('never fails a transfer, even when the alert machinery breaks', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 5000);
    for (let i = 0; i < 5; i++) await send(a, b, 100).expect(201);
    const notifications = ctx.app.get(NotificationsService);
    const real = notifications.notify.bind(notifications);
    vi.spyOn(notifications, 'notify').mockImplementation((i) => (i.category === 'security' ? Promise.reject(new Error('push down')) : real(i)));
    await send(a, b, 900).expect(201);
    expect(await k.balance(a)).toBe(5000 - 500 - 900);
  });

  it('answers: this is me dismisses, this is not me reports to the admins; each alert once, only by its owner', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    const admin = await k.user(['admin']);
    await k.topup(a, 9000);
    for (let i = 0; i < 8; i++) await send(a, b, 100).expect(201); // burst
    await send(a, b, 2000).expect(201); // outlier
    const alerts = await alertsOf(a);
    const burst = alerts.find((x) => x.rule === 'burst')!;
    const outlier = alerts.find((x) => x.rule === 'amount_outlier')!;

    await k.post(b, `/v1/wallet/alerts/${burst.id}/confirm-mine`).expect(404);
    const mine = await k.post(a, `/v1/wallet/alerts/${burst.id}/confirm-mine`).expect(200);
    expect(mine.body).toMatchObject({ status: 'dismissed', reported: false });
    await k.post(a, `/v1/wallet/alerts/${burst.id}/report`).expect(409);

    const rep = await k.post(a, `/v1/wallet/alerts/${outlier.id}/report`).expect(200);
    expect(rep.body).toMatchObject({ status: 'reviewed', reported: true });

    await k.get(a, '/v1/admin/wallet-alerts').expect(403);
    const reported = await k.get(admin, '/v1/admin/wallet-alerts?reported=true').expect(200);
    expect(reported.body.items.map((x: { id: string }) => x.id)).toEqual([outlier.id]);
    expect(reported.body.items[0].user.handle).toBe(a.handle);
    const open = await k.get(admin, '/v1/admin/wallet-alerts?status=open').expect(200);
    expect(open.body.items.every((x: { status: string }) => x.status === 'open')).toBe(true);

    const reviewed = await k.post(admin, `/v1/admin/wallet-alerts/${outlier.id}/review`).expect(200);
    expect(reviewed.body.status).toBe('reviewed');
    await ctx.http.get('/v1/admin/wallet-alerts').expect(401);
    const audit = await ctx.sql.query(`SELECT action FROM audit_events WHERE subject_user_id = $1 AND action LIKE 'wallet.alert_%' ORDER BY id`, [a.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['wallet.alert_confirmed', 'wallet.alert_reported', 'wallet.alert_reviewed']);
    void bearer;
  });
});
