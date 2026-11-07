import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, otpauthUri, totp, verifyTotp } from '../src/auth/identity/totp.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext, uniqueEmail } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const device = { name: 'Phone', platform: 'android' };

describe('TOTP (RFC 6238 vectors)', () => {
  // RFC 6238 appendix B, SHA-1, 8 digits, secret "12345678901234567890".
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('t=%i -> %s', (t, expected) => {
    expect(hotp(secret, Math.floor(t / 30), 8)).toBe(expected);
  });

  it('accepts +-1 step, refuses further and reports the step', () => {
    const b32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(base32Decode(b32).toString()).toBe('12345678901234567890');
    const now = 1_700_000_000_000;
    const code = totp(b32, now);
    expect(verifyTotp(b32, code, now)).toBe(Math.floor(now / 30000));
    expect(verifyTotp(b32, code, now + 30_000)).not.toBeNull();
    expect(verifyTotp(b32, code, now + 90_000)).toBeNull();
    expect(otpauthUri(b32, 'a@b.test')).toMatch(/^otpauth:\/\/totp\/CASELIND:a%40b\.test\?.*issuer=CASELIND/);
  });
});

async function enroll(user: { identifier: string; tokens: { accessToken: string } }) {
  const setup = await ctx.http.post('/v1/me/2fa/totp/setup').set(bearer(user.tokens.accessToken)).expect(200);
  expect(setup.body.otpauthUri).toContain('otpauth://totp/CASELIND');
  const secret = setup.body.secret as string;
  const enable = await ctx.http
    .post('/v1/me/2fa/totp/enable')
    .set(bearer(user.tokens.accessToken))
    .send({ code: totp(secret, Date.now()), password: PASSWORD })
    .expect(200);
  return { secret, backupCodes: enable.body.backupCodes as string[] };
}

const resetStep = (identifier: string) =>
  ctx.sql.query('UPDATE user_totp SET last_used_step = 0 WHERE user_id = (SELECT id FROM users WHERE email = $1)', [identifier]);

describe('two-factor authentication', () => {
  it('enrols, stores the secret encrypted, and requires a second step at login', async () => {
    const user = await signUp(ctx);
    const wrong = await ctx.http
      .post('/v1/me/2fa/totp/setup')
      .set(bearer(user.tokens.accessToken))
      .expect(200);
    await ctx.http
      .post('/v1/me/2fa/totp/enable')
      .set(bearer(user.tokens.accessToken))
      .send({ code: totp(wrong.body.secret, Date.now() + 300_000), password: PASSWORD })
      .expect(400);
    await ctx.http
      .post('/v1/me/2fa/totp/enable')
      .set(bearer(user.tokens.accessToken))
      .send({ code: totp(wrong.body.secret, Date.now()), password: 'not-the-password' })
      .expect(401);

    const { secret, backupCodes } = await enroll(user);
    expect(backupCodes).toHaveLength(10);
    const { rows } = await ctx.sql.query('SELECT secret_enc FROM user_totp');
    expect(rows.map((r) => r.secret_enc).join()).not.toContain(secret);
    const hashes = await ctx.sql.query('SELECT code_hash FROM user_backup_codes');
    expect(hashes.rows.map((r) => r.code_hash).join()).not.toContain(backupCodes[0]!);

    const login = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: user.identifier, password: PASSWORD, device })
      .expect(200);
    expect(login.body).toEqual({ twoFactorRequired: true, challengeId: expect.any(String) });
    expect(login.body.accessToken).toBeUndefined();

    // The step used at enrolment is spent: a replay is refused, a fresh step passes.
    const replay = await ctx.http
      .post('/v1/auth/2fa/verify')
      .send({ challengeId: login.body.challengeId, code: totp(secret, Date.now()), device })
      .expect(400);
    expect(replay.body.error.code).toBe('otp_invalid');
    const ok = await ctx.http
      .post('/v1/auth/2fa/verify')
      .send({ challengeId: login.body.challengeId, code: totp(secret, Date.now() + 30_000), device })
      .expect(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));
    await ctx.http.get('/v1/me').set(bearer(ok.body.accessToken)).expect(200);
    // The challenge is single use.
    await ctx.http
      .post('/v1/auth/2fa/verify')
      .send({ challengeId: login.body.challengeId, code: totp(secret, Date.now() + 30_000), device })
      .expect(400);

    const exp = await ctx.http.get('/v1/me/export').set(bearer(ok.body.accessToken)).expect(200);
    expect(exp.body.twoFactorEnabled).toBe(true);
    expect(exp.body.twoFactorEnabledAt).toEqual(expect.any(String));
    expect(JSON.stringify(exp.body)).not.toContain(secret);
    const events = (await ctx.http.get('/v1/me/security-events').set(bearer(ok.body.accessToken))).body.items.map(
      (e: { action: string }) => e.action,
    );
    expect(events).toContain('auth.2fa_enabled');
    const notes = await ctx.http.get('/v1/notifications').set(bearer(ok.body.accessToken)).expect(200);
    expect(JSON.stringify(notes.body)).toContain('deux facteurs');
    const audit = await ctx.sql.query('SELECT metadata FROM audit_events');
    expect(JSON.stringify(audit.rows)).not.toContain(secret);
  });

  it('accepts a backup code once, then disables with a TOTP code', async () => {
    const user = await signUp(ctx);
    const { secret, backupCodes } = await enroll(user);
    const code = backupCodes[0]!;
    const start = async () =>
      (await ctx.http.post('/v1/auth/login').send({ identifier: user.identifier, password: PASSWORD, device }).expect(200))
        .body.challengeId as string;

    const first = await start();
    await ctx.http.post('/v1/auth/2fa/verify').send({ challengeId: first, backupCode: code, device }).expect(200);
    const second = await start();
    const again = await ctx.http
      .post('/v1/auth/2fa/verify')
      .send({ challengeId: second, backupCode: code, device })
      .expect(400);
    expect(again.body.error.code).toBe('otp_invalid');
    const events = await ctx.sql.query("SELECT 1 FROM audit_events WHERE action = 'auth.2fa_backup_used'");
    expect(events.rowCount).toBe(1);

    await resetStep(user.identifier);
    await ctx.http
      .post('/v1/me/2fa/totp/disable')
      .set(bearer(user.tokens.accessToken))
      .send({ password: PASSWORD, code: '000000' })
      .expect(400);
    await ctx.http
      .post('/v1/me/2fa/totp/disable')
      .set(bearer(user.tokens.accessToken))
      .send({ password: PASSWORD, code: totp(secret, Date.now()) })
      .expect(204);
    const login = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: user.identifier, password: PASSWORD, device })
      .expect(200);
    expect(login.body.accessToken).toEqual(expect.any(String));
    const uid = `(SELECT id FROM users WHERE email = $1)`;
    const left = await ctx.sql.query(`SELECT 1 FROM user_totp WHERE user_id = ${uid} UNION ALL SELECT 1 FROM user_backup_codes WHERE user_id = ${uid}`, [user.identifier]);
    expect(left.rowCount).toBe(0);
  });

  it('kills a challenge after 5 wrong attempts and refuses an expired one', async () => {
    const user = await signUp(ctx);
    const { secret } = await enroll(user);
    await resetStep(user.identifier);
    const start = async () =>
      (await ctx.http.post('/v1/auth/login').send({ identifier: user.identifier, password: PASSWORD, device }).expect(200))
        .body.challengeId as string;

    const id = await start();
    for (let i = 0; i < 5; i++) {
      await ctx.http.post('/v1/auth/2fa/verify').send({ challengeId: id, code: '000000', device }).expect(400);
    }
    const dead = await ctx.http
      .post('/v1/auth/2fa/verify')
      .send({ challengeId: id, code: totp(secret, Date.now()), device })
      .expect(410);
    expect(dead.body.error.code).toBe('otp_expired');

    const id2 = await start();
    await ctx.sql.query("UPDATE two_factor_challenges SET expires_at = now() - interval '1 minute' WHERE id = $1", [id2]);
    await ctx.http.post('/v1/auth/2fa/verify').send({ challengeId: id2, code: totp(secret, Date.now()), device }).expect(410);
  });
});

describe('identifier change', () => {
  it('changes the e-mail after a code sent to the new one, warns the old one, revokes other sessions', async () => {
    const user = await signUp(ctx);
    const second = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: user.identifier, password: PASSWORD, device })
      .expect(200);
    const fresh = uniqueEmail('new');
    await ctx.http
      .post('/v1/me/identifier-change')
      .set(bearer(user.tokens.accessToken))
      .send({ newIdentifier: fresh, password: 'bad-password-123' })
      .expect(401);
    const req = await ctx.http
      .post('/v1/me/identifier-change')
      .set(bearer(user.tokens.accessToken))
      .send({ newIdentifier: fresh, password: PASSWORD })
      .expect(202);
    expect(req.body.channel).toBe('email');
    const code = ctx.otp.lastCodeFor(fresh);
    await ctx.http
      .post('/v1/me/identifier-change/verify')
      .set(bearer(user.tokens.accessToken))
      .send({ challengeId: req.body.challengeId, code })
      .expect(204);

    const me = await ctx.http.get('/v1/me').set(bearer(user.tokens.accessToken)).expect(200);
    expect(me.body.email).toBe(fresh);
    expect(ctx.otp.messages).toContainEqual({ kind: 'identifier_changed', channel: 'email', destination: user.identifier });
    await ctx.http.get('/v1/me').set(bearer(second.body.accessToken)).expect(401);
    await ctx.http.post('/v1/auth/login').send({ identifier: fresh, password: PASSWORD, device }).expect(200);
  });

  it('answers the same for a taken identifier and fails with 409 only at confirmation', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    const req = await ctx.http
      .post('/v1/me/identifier-change')
      .set(bearer(a.tokens.accessToken))
      .send({ newIdentifier: b.identifier, password: PASSWORD })
      .expect(202);
    expect(Object.keys(req.body).sort()).toEqual(['challengeId', 'channel', 'expiresAt']);
    const res = await ctx.http
      .post('/v1/me/identifier-change/verify')
      .set(bearer(a.tokens.accessToken))
      .send({ challengeId: req.body.challengeId, code: ctx.otp.lastCodeFor(b.identifier) })
      .expect(409);
    expect(res.body.error.code).toBe('conflict');
    const me = await ctx.http.get('/v1/me').set(bearer(a.tokens.accessToken)).expect(200);
    expect(me.body.email).toBe(a.identifier);
  });

  it("refuses another user's challenge", async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    const fresh = uniqueEmail('x');
    const req = await ctx.http
      .post('/v1/me/identifier-change')
      .set(bearer(a.tokens.accessToken))
      .send({ newIdentifier: fresh, password: PASSWORD })
      .expect(202);
    await ctx.http
      .post('/v1/me/identifier-change/verify')
      .set(bearer(b.tokens.accessToken))
      .send({ challengeId: req.body.challengeId, code: ctx.otp.lastCodeFor(fresh) })
      .expect(400);
  });
});

describe('QR web login', () => {
  const create = async () =>
    (await ctx.http.post('/v1/auth/qr/session').send({ device: { name: 'Chrome', platform: 'web' } }).expect(201)).body as {
      qrSessionId: string;
      qrPayload: string;
      expiresAt: string;
      sessionSecret: string;
    };
  const poll = (q: { qrSessionId: string }, secret: string) =>
    ctx.http.get(`/v1/auth/qr/session/${q.qrSessionId}`).set('X-QR-Session-Secret', secret);

  it('creates, previews, approves and delivers the tokens exactly once', async () => {
    const user = await signUp(ctx);
    const q = await create();
    expect(q.qrPayload).not.toContain(q.sessionSecret);
    expect(Date.parse(q.expiresAt) - Date.now()).toBeLessThanOrEqual(120_000);
    expect((await poll(q, q.sessionSecret).expect(200)).body).toEqual({ status: 'pending' });
    await poll(q, 'wrong-secret').expect(404);

    const preview = await ctx.http
      .post('/v1/auth/qr/approve')
      .set(bearer(user.tokens.accessToken))
      .send({ qrPayload: q.qrPayload })
      .expect(200);
    expect(preview.body).toMatchObject({ status: 'confirmation_required', device: { name: 'Chrome', platform: 'web' } });
    expect((await poll(q, q.sessionSecret).expect(200)).body.status).toBe('pending');

    await ctx.http.post('/v1/auth/qr/approve').send({ qrPayload: q.qrPayload, confirm: true }).expect(401);
    await ctx.http
      .post('/v1/auth/qr/approve')
      .set(bearer(user.tokens.accessToken))
      .send({ qrPayload: q.qrPayload, confirm: true })
      .expect(200);

    const done = await poll(q, q.sessionSecret).expect(200);
    expect(done.body.status).toBe('approved');
    await ctx.http.get('/v1/me').set(bearer(done.body.tokens.accessToken)).expect(200);
    expect((await poll(q, q.sessionSecret).expect(200)).body).toEqual({ status: 'expired' });
  });

  it('expires, and refuses unknown payloads', async () => {
    const user = await signUp(ctx);
    const q = await create();
    await ctx.sql.query("UPDATE qr_login_sessions SET expires_at = now() - interval '1 second' WHERE id = $1", [q.qrSessionId]);
    expect((await poll(q, q.sessionSecret).expect(200)).body).toEqual({ status: 'expired' });
    await ctx.http
      .post('/v1/auth/qr/approve')
      .set(bearer(user.tokens.accessToken))
      .send({ qrPayload: q.qrPayload, confirm: true })
      .expect(410);
    await ctx.http
      .post('/v1/auth/qr/approve')
      .set(bearer(user.tokens.accessToken))
      .send({ qrPayload: 'caselind-qr1:not-a-real:payload-value' })
      .expect(404);
  });
});

describe('rate limit of the account-security routes', () => {
  it('throttles second-factor guesses and identifier-change sends like the credential routes', async () => {
    const limited = await createTestContext({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const user = await signUp(limited);
      const send = () =>
        limited.http
          .post('/v1/me/identifier-change')
          .set(bearer(user.tokens.accessToken))
          .send({ newIdentifier: uniqueEmail(), password: 'wrong-password-123' });
      for (let i = 0; i < 3; i++) expect((await send()).status).toBe(401);
      expect((await send()).status).toBe(429);
      const disable = () =>
        limited.http
          .post('/v1/me/2fa/totp/disable')
          .set(bearer(user.tokens.accessToken))
          .send({ password: 'wrong-password-123', code: '123456' });
      for (let i = 0; i < 3; i++) expect((await disable()).status).toBe(401);
      expect((await disable()).status).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('GET /v1/me twoFactorEnabled', () => {
  it('is false until 2FA is enabled and true after', async () => {
    const user = await signUp(ctx);
    const before = await ctx.http.get('/v1/me').set(bearer(user.tokens.accessToken)).expect(200);
    expect(before.body.twoFactorEnabled).toBe(false);
    await enroll(user);
    const after = await ctx.http.get('/v1/me').set(bearer(user.tokens.accessToken)).expect(200);
    expect(after.body.twoFactorEnabled).toBe(true);
  });
});
