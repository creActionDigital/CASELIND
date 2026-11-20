import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ScheduledPaymentsService } from '../src/wallet-finance/scheduled-payments.service.js';
import { createTestContext, type TestContext } from './helpers.js';
import { financeKit, type FU } from './wallet-finance-helpers.js';

/** Scheduled payments (test funds): creation rules, single execution despite repeated passes, failures, pause/resume/cancel. */
let ctx: TestContext;
let k: ReturnType<typeof financeKit>;
let svc: ScheduledPaymentsService;

beforeAll(async () => {
  ctx = await createTestContext();
  k = financeKit(ctx);
  svc = ctx.app.get(ScheduledPaymentsService);
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const schedule = (owner: FU, to: FU, over: Record<string, unknown> = {}) =>
  k.post(owner, '/v1/wallet/scheduled-payments', {
    clientId: randomUUID(),
    recipientHandle: to.handle,
    amountMinor: 500,
    currency: 'USD',
    frequency: 'weekly',
    firstRunAt: inDays(1),
    pin: '1234',
    ...over,
  });
/** Makes a payment due now (the creation rules forbid a first run in the past). */
const makeDue = (id: string) => ctx.sql.query(`UPDATE scheduled_payments SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [id]);
const row = async (id: string) => (await ctx.sql.query(`SELECT * FROM scheduled_payments WHERE id = $1`, [id])).rows[0];

describe('scheduled payments', () => {
  it('creates with the PIN, idempotently, and enforces the creation rules', async () => {
    k.limits({ maxSingleTransferMinor: 1000 });
    const a = await k.user();
    const b = await k.user();
    k.pinWrong();
    await schedule(a, b).expect(403);
    k.pinOk();
    const clientId = randomUUID();
    const first = await schedule(a, b, { clientId, note: 'Loyer' }).expect(201);
    expect(first.body).toMatchObject({ mode: 'sandbox', status: 'active', frequency: 'weekly', runsDone: 0, amountMinor: 500, note: 'Loyer' });
    expect(first.body.recipient.handle).toBe(b.handle);
    const again = await schedule(a, b, { clientId }).expect(200);
    expect(again.body.id).toBe(first.body.id);

    await schedule(a, a).expect(400);
    await schedule(a, b, { firstRunAt: inDays(-2) }).expect(400);
    await schedule(a, b, { firstRunAt: inDays(400) }).expect(400);
    await schedule(a, b, { amountMinor: 1001 }).expect(400); // above the single-transfer limit
    await schedule(a, b, { endsOn: '2000-01-01' }).expect(400);
    await schedule(a, { handle: 'unknown_zzz_user', id: '', token: '' }).expect(404);

    // 10 active at most (one already exists)
    for (let i = 0; i < 9; i++) await schedule(a, b).expect(201);
    const over = await schedule(a, b).expect(409);
    expect(JSON.stringify(over.body)).toContain('scheduled_limit');
  });

  it('runs once even when the maintenance pass repeats or overlaps; the next run is derived without drift', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 5000);
    const created = await schedule(a, b, { amountMinor: 1500 }).expect(201);
    const id = created.body.id;
    const firstRun = new Date(created.body.nextRunAt).getTime();
    await makeDue(id);

    const [r1, r2] = await Promise.all([svc.runDue(), svc.runDue()]);
    expect(r1.ok + r2.ok).toBe(1);
    await svc.runDue();
    expect(await k.balance(a)).toBe(3500);
    expect(await k.balance(b)).toBe(1500);
    const p = await row(id);
    expect(p.runs_done).toBe(1);
    expect(p.status).toBe('active');
    expect(new Date(p.next_run_at).getTime()).toBe(firstRun + 7 * 86_400_000);

    // even if the bookkeeping were rolled back, the ledger key (payment, run number) prevents a second payment
    await ctx.sql.query(`UPDATE scheduled_payments SET runs_done = 0, next_run_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    await svc.runDue();
    expect(await k.balance(a)).toBe(3500);
    expect((await row(id)).runs_done).toBe(1);
    const entries = await ctx.sql.query(`SELECT count(*)::int AS n FROM journal_entries WHERE idempotency_key = $1`, [`sched:${id}:1`]);
    expect(entries.rows[0].n).toBe(1);

    const detail = await k.get(a, `/v1/wallet/scheduled-payments/${id}`).expect(200);
    expect(detail.body.runs.filter((r: { status: string }) => r.status === 'ok')).toHaveLength(1);
    expect(detail.body.runs[0]).toMatchObject({ runNumber: 1, status: 'ok' });
    // audited without any note
    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'wallet.scheduled_run' AND actor_user_id = $1`, [a.id]);
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toContain('note');
  });

  it('completes: once, max runs and end date', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 10_000);
    const once = (await schedule(a, b, { frequency: 'once', amountMinor: 100 }).expect(201)).body.id;
    const max2 = (await schedule(a, b, { frequency: 'weekly', maxRuns: 2, amountMinor: 100 }).expect(201)).body.id;
    const ends = (await schedule(a, b, { frequency: 'weekly', endsOn: inDays(2).slice(0, 10), amountMinor: 100 }).expect(201)).body.id;
    for (let i = 0; i < 3; i++) {
      for (const id of [once, max2, ends]) await makeDue(id);
      await svc.runDue();
    }
    expect(await row(once)).toMatchObject({ status: 'completed', runs_done: 1 });
    expect(await row(max2)).toMatchObject({ status: 'completed', runs_done: 2 });
    expect(await row(ends)).toMatchObject({ status: 'completed', runs_done: 1 });
    expect(await k.balance(b)).toBe(400);
    const none = await k.get(a, `/v1/wallet/scheduled-payments/${once}/next-runs`).expect(200);
    expect(none.body.items).toEqual([]);
  });

  it('failures: retried later, then stopped after 3 consecutive failures, with generic notifications', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    const id = (await schedule(a, b, { amountMinor: 900 }).expect(201)).body.id;
    await makeDue(id);
    expect((await svc.runDue()).failed).toBe(1);
    let p = await row(id);
    expect(p).toMatchObject({ status: 'active', consecutive_failures: 1, last_error: 'insufficient_funds', runs_done: 0 });
    expect(new Date(p.next_run_at).getTime()).toBeGreaterThan(Date.now() + 3_600_000); // not retried within the hour
    expect((await svc.runDue()).failed).toBe(0);

    await makeDue(id);
    await svc.runDue();
    await makeDue(id);
    await svc.runDue();
    p = await row(id);
    expect(p).toMatchObject({ status: 'failed', consecutive_failures: 3 });
    await makeDue(id);
    expect(await svc.runDue()).toEqual({ ok: 0, failed: 0 }); // a failed payment is never run again
    expect(await k.balance(b)).toBe(0);

    const detail = await k.get(a, `/v1/wallet/scheduled-payments/${id}`).expect(200);
    expect(detail.body.status).toBe('failed');
    expect(detail.body.runs.filter((r: { status: string }) => r.status === 'failed')).toHaveLength(3);
    const notes = await ctx.sql.query(`SELECT title, body FROM notifications WHERE user_id = $1`, [a.id]);
    expect(notes.rows.length).toBe(3);
    expect(JSON.stringify(notes.rows)).not.toContain('900');
    expect(JSON.stringify(notes.rows)).toContain('mode test');
  });

  it('a frozen account fails the run; a success resets the failure counter', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 2000);
    const id = (await schedule(a, b, { amountMinor: 100 }).expect(201)).body.id;
    await ctx.sql.query(`UPDATE ledger_accounts SET status = 'frozen' WHERE user_id = $1`, [a.id]);
    await makeDue(id);
    await svc.runDue();
    expect(await row(id)).toMatchObject({ consecutive_failures: 1, last_error: 'account_frozen' });
    await ctx.sql.query(`UPDATE ledger_accounts SET status = 'active' WHERE user_id = $1`, [a.id]);
    await makeDue(id);
    await svc.runDue();
    expect(await row(id)).toMatchObject({ consecutive_failures: 0, last_error: null, runs_done: 1 });
    expect(await k.balance(a)).toBe(1900);
  });

  it('a single bad payment never stops the others, and runDue never throws', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    const c = await k.user();
    await k.topup(a, 2000);
    const bad = (await schedule(a, b, { amountMinor: 100 }).expect(201)).body.id;
    const good = (await schedule(a, c, { amountMinor: 100 }).expect(201)).body.id;
    await makeDue(bad);
    await makeDue(good);
    const spy = vi.spyOn(ctx.app.get(await import('../src/ledger/ledger.service.js').then((m) => m.LedgerService)), 'transferWith');
    spy.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.runDue()).resolves.toBeDefined();
    spy.mockRestore();
    expect(await k.balance(a)).toBeLessThan(2000); // the second payment still ran
    expect((await row(good)).runs_done + (await row(bad)).runs_done).toBe(1);
  });

  it('pause, resume and cancel; rights; next-runs preview', async () => {
    k.limits();
    k.pinOk();
    const a = await k.user();
    const b = await k.user();
    await k.topup(a, 2000);
    const id = (await schedule(a, b, { amountMinor: 100, frequency: 'monthly', maxRuns: 3 }).expect(201)).body.id;

    const preview = await k.get(a, `/v1/wallet/scheduled-payments/${id}/next-runs?count=5`).expect(200);
    expect(preview.body.items).toHaveLength(3); // capped by maxRuns
    expect(new Date(preview.body.items[0]).getTime()).toBeGreaterThan(Date.now());

    await k.get(b, `/v1/wallet/scheduled-payments/${id}`).expect(404);
    await k.post(b, `/v1/wallet/scheduled-payments/${id}/pause`).expect(404);

    expect((await k.post(a, `/v1/wallet/scheduled-payments/${id}/pause`).expect(200)).body.status).toBe('paused');
    await k.post(a, `/v1/wallet/scheduled-payments/${id}/pause`).expect(409);
    await makeDue(id);
    await svc.runDue();
    expect((await row(id)).runs_done).toBe(0); // a paused payment never runs
    expect((await k.post(a, `/v1/wallet/scheduled-payments/${id}/resume`).expect(200)).body.status).toBe('active');
    await svc.runDue();
    expect((await row(id)).runs_done).toBe(1);
    expect((await k.post(a, `/v1/wallet/scheduled-payments/${id}/cancel`).expect(200)).body.status).toBe('cancelled');
    await k.post(a, `/v1/wallet/scheduled-payments/${id}/resume`).expect(409);
    await makeDue(id);
    expect((await svc.runDue()).ok).toBe(0);
    const list = await k.get(a, '/v1/wallet/scheduled-payments').expect(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toContain(id);
  });
});
