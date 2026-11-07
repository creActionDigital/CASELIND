import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { KycPort } from '../src/wallet/kyc.port.js';
import { PinVerifier } from '../src/wallet/pin.port.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TU;

beforeAll(async () => {
  ctx = await createTestContext({ KYC_ENCRYPTION_KEY: 'ab'.repeat(32), PAYMENT_PIN_MAX_ATTEMPTS: '3' });
  const a = await signUp(ctx);
  await ctx.sql.query(`UPDATE users SET roles = ARRAY['user','admin'] WHERE email = $1`, [a.identifier]);
  admin = await toUser(a);
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
  identifier: string;
}

async function toUser(s: { identifier: string; tokens: { accessToken: string } }): Promise<TU> {
  const me = await ctx.http.get('/v1/me').set(bearer(s.tokens.accessToken)).expect(200);
  return { token: s.tokens.accessToken, id: me.body.id, identifier: s.identifier };
}
const user = async (): Promise<TU> => toUser(await signUp(ctx));

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');

/** Uploads a ready identity document and returns its media id. */
async function doc(u: TU, kind: 'png' | 'pdf' = 'png', purpose = 'kyc_document'): Promise<string> {
  const content = kind === 'png' ? TINY_PNG : TINY_PDF;
  const mime = kind === 'png' ? 'image/png' : 'application/pdf';
  const up = await ctx.http.post('/v1/media/uploads').set(bearer(u.token)).send({ purpose, mime, sizeBytes: content.length }).expect(201);
  const res = await ctx.http
    .put(up.body.uploadUrl)
    .set(bearer(u.token))
    .set('X-Upload-Token', up.body.uploadToken)
    .set('Content-Type', 'application/octet-stream')
    .send(content)
    .expect(200);
  return res.body.id as string;
}

const ID_NUMBER = 'CD-998877-ZX42';
const level1 = (documentIds: string[], extra: Record<string, unknown> = {}) => ({
  level: 1,
  legalName: 'Awa Diallo',
  birthDate: '1995-04-12',
  idType: 'national_id',
  idNumber: ID_NUMBER,
  city: 'Kinshasa',
  documentIds,
  ...extra,
});

const submit = (u: TU, body: unknown) => ctx.http.post('/v1/me/kyc/submissions').set(bearer(u.token)).send(body as object);
const decide = (who: TU, id: string, body: unknown) =>
  ctx.http.post(`/v1/admin/kyc/submissions/${id}/decision`).set(bearer(who.token)).send(body as object);

async function submitLevel1(u: TU): Promise<string> {
  const res = await submit(u, level1([await doc(u), await doc(u)])).expect(201);
  return res.body.id as string;
}

describe('KYC submission', () => {
  it('starts at level 0 with prudent limits and requires authentication', async () => {
    await ctx.http.get('/v1/me/kyc').expect(401);
    const u = await user();
    const res = await ctx.http.get('/v1/me/kyc').set(bearer(u.token)).expect(200);
    expect(res.body).toMatchObject({ level: 0, pending: null, lastDecision: null, hasPaymentPin: false });
    const usd = res.body.limits.find((l: { currency: string }) => l.currency === 'USD');
    const nextUsd = res.body.nextLevelLimits.find((l: { currency: string }) => l.currency === 'USD');
    expect(nextUsd.maxBalanceMinor).toBeGreaterThan(usd.maxBalanceMinor);
  });

  it('accepts a level 1 request, masks the number and keeps one pending request', async () => {
    const u = await user();
    const res = await submit(u, level1([await doc(u, 'pdf'), await doc(u)])).expect(201);
    expect(res.body).toMatchObject({ level: 1, status: 'pending', legalName: 'Awa Diallo', idNumberLast4: 'ZX42', city: 'Kinshasa' });
    expect(JSON.stringify(res.body)).not.toContain('998877');
    const status = await ctx.http.get('/v1/me/kyc').set(bearer(u.token)).expect(200);
    expect(status.body.pending.id).toBe(res.body.id);
    expect(JSON.stringify(status.body)).not.toContain('998877');

    const again = await submit(u, level1([await doc(u), await doc(u)])).expect(409);
    expect(again.body.error.details.reason).toBe('pending_exists');
  });

  it('stores the number encrypted, never in clear', async () => {
    const u = await user();
    const id = await submitLevel1(u);
    const { rows } = await ctx.sql.query(`SELECT id_number_enc, id_number_last4, legal_name FROM kyc_submissions WHERE id = $1`, [id]);
    expect(rows[0].id_number_enc).toMatch(/^v1:/);
    expect(rows[0].id_number_enc).not.toContain('998877');
    expect(rows[0].id_number_last4).toBe('ZX42');
    const dump = await ctx.sql.query(`SELECT count(*)::int AS n FROM audit_events WHERE metadata::text LIKE '%998877%' OR metadata::text LIKE '%Diallo%'`);
    expect(dump.rows[0].n).toBe(0);
  });

  it('validates documents, age and level order', async () => {
    const u = await user();
    const other = await user();
    const mine = await doc(u);
    const foreign = await doc(other);
    const wrongPurpose = await doc(u, 'pdf', 'document');
    await submit(u, level1([mine, foreign])).expect(400);
    await submit(u, level1([mine, wrongPurpose])).expect(400);
    await submit(u, level1([mine, mine])).expect(400);
    await submit(u, level1([mine, randomUUID()])).expect(400);
    // The selfie must be an image.
    await submit(u, level1([await doc(u), await doc(u, 'pdf')])).expect(400);
    await submit(u, level1([await doc(u), await doc(u)], { birthDate: '2015-01-01' })).expect(400);
    await submit(u, level1([await doc(u), await doc(u)], { idNumber: '12' })).expect(400);
    const l2 = await submit(u, { level: 2, documentIds: [await doc(u, 'pdf')] }).expect(409);
    expect(l2.body.error.details.reason).toBe('level_1_required');
  });
});

describe('KYC review', () => {
  it('lets only admins list, read and decide', async () => {
    const u = await user();
    const id = await submitLevel1(u);
    await ctx.http.get('/v1/admin/kyc/submissions').set(bearer(u.token)).expect(403);
    await ctx.http.get(`/v1/admin/kyc/submissions/${id}`).set(bearer(u.token)).expect(403);
    await decide(u, id, { decision: 'approve' }).expect(403);

    const list = await ctx.http.get('/v1/admin/kyc/submissions?status=pending').set(bearer(admin.token)).expect(200);
    expect(list.body.items.map((s: { id: string }) => s.id)).toContain(id);
    expect(JSON.stringify(list.body)).not.toContain('998877');
    const one = await ctx.http.get(`/v1/admin/kyc/submissions/${id}`).set(bearer(admin.token)).expect(200);
    expect(one.body).toMatchObject({ userId: u.id, idNumberLast4: 'ZX42' });
    expect(one.body.documents).toHaveLength(2);
    await ctx.http.get('/v1/admin/kyc/submissions/not-a-uuid').set(bearer(admin.token)).expect(404);
  });

  it('approves: raises the level, notifies the user, audits, and unlocks level 2', async () => {
    const u = await user();
    const id = await submitLevel1(u);
    await decide(admin, id, { decision: 'approve' }).expect(200);
    const status = await ctx.http.get('/v1/me/kyc').set(bearer(u.token)).expect(200);
    expect(status.body).toMatchObject({ level: 1, pending: null });
    expect(status.body.lastDecision.status).toBe('approved');

    const notes = await ctx.http.get('/v1/notifications').set(bearer(u.token)).expect(200);
    expect(notes.body.items.some((n: { category: string }) => n.category === 'security')).toBe(true);
    const audit = await ctx.sql.query(`SELECT action, actor_user_id FROM audit_events WHERE subject_user_id = $1 AND action LIKE 'kyc.%' ORDER BY id`, [u.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['kyc.submitted', 'kyc.approved']);
    expect(audit.rows[1].actor_user_id).toBe(admin.id);

    await decide(admin, id, { decision: 'reject', reason: 'late' }).expect(409);
    await submit(u, level1([await doc(u), await doc(u)])).expect(409);

    const l2 = await submit(u, { level: 2, documentIds: [await doc(u, 'pdf')] }).expect(201);
    await decide(admin, l2.body.id, { decision: 'approve' }).expect(200);
    expect((await ctx.http.get('/v1/me/kyc').set(bearer(u.token)).expect(200)).body).toMatchObject({ level: 2, nextLevelLimits: null });
  });

  it('rejects with a reason (required), lets the user try again, and refuses self-review', async () => {
    const u = await user();
    const id = await submitLevel1(u);
    await decide(admin, id, { decision: 'reject' }).expect(400);
    await decide(admin, id, { decision: 'reject', reason: 'Photo illisible' }).expect(200);
    const status = await ctx.http.get('/v1/me/kyc').set(bearer(u.token)).expect(200);
    expect(status.body).toMatchObject({ level: 0, pending: null });
    expect(status.body.lastDecision).toMatchObject({ status: 'rejected', decisionReason: 'Photo illisible' });
    await submitLevel1(u);

    // An admin cannot review their own request.
    const mine = await submitLevel1(admin);
    await decide(admin, mine, { decision: 'approve' }).expect(403);
  });
});

describe('limits read by KycPort', () => {
  it('follow the tier and the currency', async () => {
    const kyc = ctx.app.get(KycPort);
    const u = await user();
    const l0 = await kyc.limitsFor(u.id, 'USD');
    expect(l0.tier).toBe(0);
    await decide(admin, await submitLevel1(u), { decision: 'approve' }).expect(200);
    const l1 = await kyc.limitsFor(u.id, 'USD');
    expect(l1.tier).toBe(1);
    expect(l1.maxSingleTransferMinor).toBeGreaterThan(l0.maxSingleTransferMinor);
    const cdf = await kyc.limitsFor(u.id, 'CDF');
    expect(cdf.maxBalanceMinor).toBeGreaterThan(l1.maxBalanceMinor);
  });
});

describe('identity documents access', () => {
  it('are unreadable by other users (404) and readable by the owner and admins', async () => {
    const u = await user();
    const stranger = await user();
    const id = await doc(u);
    await ctx.http.get(`/v1/media/${id}`).set(bearer(stranger.token)).expect(404);
    await ctx.http.get(`/v1/media/${id}/content`).set(bearer(stranger.token)).expect(404);
    await ctx.http.get(`/v1/media/${id}/content`).set(bearer(u.token)).expect(200);
    await ctx.http.get(`/v1/media/${id}/content`).set(bearer(admin.token)).expect(404); // not submitted yet
    await ctx.sql.query(`INSERT INTO kyc_submissions (user_id, level, document_ids) VALUES ($1, 2, $2)`, [u.id, [id]]);
    const asAdmin = await ctx.http.get(`/v1/media/${id}/content`).set(bearer(admin.token)).expect(200);
    expect(asAdmin.headers['content-type']).toBe('image/png');
    await ctx.http.get(`/v1/media/${id}/content`).expect(401);
  });

  it('are readable by an admin only once attached to a submission', async () => {
    const u = await user();
    const loose = await doc(u);
    await ctx.http.get(`/v1/media/${loose}/content`).set(bearer(admin.token)).expect(404);
    const sub = await submitLevel1(u);
    expect(sub).toBeTruthy();
    const attached = (await ctx.sql.query(`SELECT document_ids FROM kyc_submissions WHERE user_id = $1`, [u.id])).rows[0].document_ids as string[];
    await ctx.http.get(`/v1/media/${attached[0]}/content`).set(bearer(admin.token)).expect(200);
  });

  it('accept images and PDF only', async () => {
    const u = await user();
    await ctx.http.post('/v1/media/uploads').set(bearer(u.token)).send({ purpose: 'kyc_document', mime: 'video/mp4', sizeBytes: 100 }).expect(400);
  });
});

describe('payment PIN', () => {
  it('requires the password, refuses weak PINs and never stores or exports the PIN', async () => {
    const u = await user();
    const put = (body: object) => ctx.http.put('/v1/me/payment-pin').set(bearer(u.token)).send(body);
    await put({ pin: '482916', password: 'wrong-password' }).expect(401);
    for (const pin of ['123456', '654321', '111111', '121212', '123123', '12345', '12a456']) {
      await put({ pin, password: PASSWORD }).expect(400);
    }
    await put({ pin: '482916', password: PASSWORD }).expect(204);
    const { rows } = await ctx.sql.query(`SELECT pin_hash FROM payment_pins WHERE user_id = $1`, [u.id]);
    expect(rows[0].pin_hash).toMatch(/^\$argon2id\$/);
    expect((await ctx.http.get('/v1/me/kyc').set(bearer(u.token)).expect(200)).body.hasPaymentPin).toBe(true);

    const events = await ctx.sql.query(`SELECT action, metadata FROM audit_events WHERE subject_user_id = $1 AND action = 'wallet.pin_set'`, [u.id]);
    expect(events.rows).toHaveLength(1);
    expect(JSON.stringify(events.rows)).not.toContain('482916');
    await put({ pin: '739150', password: PASSWORD }).expect(204);
    const changed = await ctx.sql.query(`SELECT metadata->>'changed' AS changed FROM audit_events WHERE subject_user_id = $1 AND action = 'wallet.pin_set' ORDER BY id`, [u.id]);
    expect(changed.rows.map((r) => r.changed)).toEqual(['false', 'true']);
    const notes = await ctx.http.get('/v1/notifications').set(bearer(u.token)).expect(200);
    expect(notes.body.items.filter((n: { category: string }) => n.category === 'security')).toHaveLength(2);
  });

  it('verifies, counts wrong attempts, locks after the limit and resets on success', async () => {
    const verifier = ctx.app.get(PinVerifier);
    const u = await user();
    expect((await verifier.verify(u.id, '482916')).status).toBe('not_set');
    await ctx.http.put('/v1/me/payment-pin').set(bearer(u.token)).send({ pin: '482916', password: PASSWORD }).expect(204);

    expect(await verifier.verify(u.id, '000001')).toEqual({ status: 'invalid', attemptsRemaining: 2 });
    expect(await verifier.verify(u.id, '000002')).toEqual({ status: 'invalid', attemptsRemaining: 1 });
    expect((await verifier.verify(u.id, '482916')).status).toBe('ok'); // success resets the counter
    expect((await ctx.sql.query(`SELECT failed_count FROM payment_pins WHERE user_id = $1`, [u.id])).rows[0].failed_count).toBe(0);

    for (let i = 0; i < 3; i += 1) expect((await verifier.verify(u.id, '000003')).status).toBe('invalid');
    const lockedCheck = await verifier.verify(u.id, '482916');
    expect(lockedCheck.status).toBe('locked'); // even the right PIN
    const events = await ctx.sql.query(`SELECT action FROM audit_events WHERE subject_user_id = $1 AND action LIKE 'wallet.pin_%' ORDER BY id`, [u.id]);
    expect(events.rows.map((r) => r.action)).toContain('wallet.pin_locked');

    // The lock expires; changing the PIN also clears it.
    await ctx.sql.query(`UPDATE payment_pins SET locked_until = now() - interval '1 second' WHERE user_id = $1`, [u.id]);
    expect((await verifier.verify(u.id, '482916')).status).toBe('ok');
    await ctx.sql.query(`UPDATE payment_pins SET locked_until = now() + interval '5 minutes' WHERE user_id = $1`, [u.id]);
    await ctx.http.put('/v1/me/payment-pin').set(bearer(u.token)).send({ pin: '739150', password: PASSWORD }).expect(204);
    expect((await verifier.verify(u.id, '739150')).status).toBe('ok');
  });

  it('counts parallel wrong guesses: 10 concurrent attempts yield exactly 3 invalid, the rest locked', async () => {
    const verifier = ctx.app.get(PinVerifier);
    const u = await user();
    await ctx.http.put('/v1/me/payment-pin').set(bearer(u.token)).send({ pin: '482916', password: PASSWORD }).expect(204);
    const results = await Promise.all(Array.from({ length: 10 }, () => verifier.verify(u.id, '000009')));
    expect(results.filter((r) => r.status === 'invalid')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'locked')).toHaveLength(7);
  });
});

describe('account export and purge', () => {
  it('exports statuses and dates only, then purges documents, PIN and identity but keeps the decisions in the audit', async () => {
    const u = await user();
    await ctx.http.put('/v1/me/payment-pin').set(bearer(u.token)).send({ pin: '482916', password: PASSWORD }).expect(204);
    const fileId = await doc(u);
    const selfie = await doc(u);
    const sub = await submit(u, level1([fileId, selfie])).expect(201);
    await decide(admin, sub.body.id, { decision: 'approve' }).expect(200);

    const exp = await ctx.http.get('/v1/me/export').set(bearer(u.token)).expect(200);
    expect(exp.body.kyc).toMatchObject({ level: 1, hasPaymentPin: true });
    expect(exp.body.kyc.submissions).toHaveLength(1);
    expect(exp.body.kyc.submissions[0]).toMatchObject({ id: sub.body.id, level: 1, status: 'approved' });
    const text = JSON.stringify(exp.body);
    for (const secret of ['998877', 'ZX42', 'Diallo', fileId, selfie, '1995-04-12', 'argon2']) expect(text).not.toContain(secret);

    await ctx.http.post('/v1/me/deletion-request').set(bearer(u.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '40 days' WHERE id = $1`, [u.id]);
    const maintenance = ctx.app.get(MaintenanceService);
    await maintenance.runOnce();
    await maintenance.runOnce();

    const left = await ctx.sql.query(
      `SELECT (SELECT count(*)::int FROM kyc_submissions WHERE user_id = $1) AS subs,
              (SELECT count(*)::int FROM kyc_profiles WHERE user_id = $1) AS profiles,
              (SELECT count(*)::int FROM payment_pins WHERE user_id = $1) AS pins,
              (SELECT count(*)::int FROM media_assets WHERE owner_user_id = $1) AS media`,
      [u.id],
    );
    expect(left.rows[0]).toEqual({ subs: 0, profiles: 0, pins: 0, media: 0 });
    const audit = await ctx.sql.query(`SELECT action FROM audit_events WHERE subject_user_id = $1 AND action LIKE 'kyc.%'`, [u.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['kyc.submitted', 'kyc.approved']));
  });
});
