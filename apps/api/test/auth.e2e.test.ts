import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totp } from '../src/auth/identity/totp.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext, uniqueEmail } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('registration and OTP verification', () => {
  it('registers with an e-mail, sends a code, and activates the account on verification', async () => {
    const email = uniqueEmail();
    const reg = await ctx.http
      .post('/v1/auth/register')
      .send({ identifier: email, password: PASSWORD, displayName: 'Amani Kabila' })
      .expect(202);
    expect(reg.body).toMatchObject({ channel: 'email' });

    const { rows } = await ctx.sql.query('SELECT status, password_hash FROM users WHERE email = $1', [email]);
    expect(rows[0].status).toBe('pending_verification');
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);

    const code = ctx.otp.lastCodeFor(email);
    const res = await ctx.http
      .post('/v1/auth/otp/verify')
      .send({ challengeId: reg.body.challengeId, code, device: { platform: 'ios', name: 'iPhone' } })
      .expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));

    const me = await ctx.http.get('/v1/me').set(bearer(res.body.accessToken)).expect(200);
    expect(me.body).toMatchObject({ email, displayName: 'Amani Kabila', status: 'active', roles: ['user'] });
    expect(me.body.handle).toMatch(/^amani_kabila_\d{4}$/);
  });

  it('registers with an E.164 phone number over the sms channel', async () => {
    const phone = `+2438${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const reg = await ctx.http
      .post('/v1/auth/register')
      .send({ identifier: phone, password: PASSWORD, displayName: 'Neema' })
      .expect(202);
    expect(reg.body.channel).toBe('sms');
    expect(ctx.otp.lastCodeFor(phone)).toMatch(/^\d{6}$/);
  });

  it('rejects invalid input with a validation_failed envelope', async () => {
    const res = await ctx.http
      .post('/v1/auth/register')
      .send({ identifier: '0812345678', password: 'short', displayName: '' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.requestId).toEqual(expect.any(String));
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['identifier', 'password', 'displayName']),
    );
  });

  it('does not reveal that an identifier is already registered, and never sends it a code', async () => {
    const { identifier } = await signUp(ctx);
    const sentBefore = ctx.otp.messages.length;

    const res = await ctx.http
      .post('/v1/auth/register')
      .send({ identifier, password: 'another-password-123', displayName: 'Intruder' })
      .expect(202);
    expect(Object.keys(res.body).sort()).toEqual(['challengeId', 'channel', 'expiresAt']);

    const newMessages = ctx.otp.messages.slice(sentBefore);
    expect(newMessages).toEqual([{ kind: 'already_registered', channel: 'email', destination: identifier }]);

    // The decoy challenge can never be verified, whatever the code.
    for (const code of ['000000', '123456']) {
      const v = await ctx.http
        .post('/v1/auth/otp/verify')
        .send({ challengeId: res.body.challengeId, code })
        .expect(400);
      expect(v.body.error.code).toBe('otp_invalid');
    }
    // The original password still works.
    await ctx.http.post('/v1/auth/login').send({ identifier, password: PASSWORD }).expect(200);
  });

  it('rejects a wrong code, expires the challenge after 5 attempts', async () => {
    const email = uniqueEmail();
    const reg = await ctx.http
      .post('/v1/auth/register')
      .send({ identifier: email, password: PASSWORD, displayName: 'Brute' })
      .expect(202);
    const good = ctx.otp.lastCodeFor(email);
    const wrong = good === '000000' ? '111111' : '000000';

    const first = await ctx.http
      .post('/v1/auth/otp/verify')
      .send({ challengeId: reg.body.challengeId, code: wrong })
      .expect(400);
    expect(first.body.error.details.attemptsRemaining).toBe(4);
    for (let i = 0; i < 4; i++) {
      await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: reg.body.challengeId, code: wrong }).expect(400);
    }
    // Even the right code is refused once the attempts are exhausted.
    const res = await ctx.http
      .post('/v1/auth/otp/verify')
      .send({ challengeId: reg.body.challengeId, code: good })
      .expect(410);
    expect(res.body.error.code).toBe('otp_expired');
  });

  it('a code is single-use', async () => {
    const email = uniqueEmail();
    const reg = await ctx.http
      .post('/v1/auth/register')
      .send({ identifier: email, password: PASSWORD, displayName: 'Once' })
      .expect(202);
    const code = ctx.otp.lastCodeFor(email);
    await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: reg.body.challengeId, code }).expect(200);
    await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: reg.body.challengeId, code }).expect(400);
  });

  it('resend issues a new code and invalidates the previous one', async () => {
    const email = uniqueEmail();
    const reg = await ctx.http
      .post('/v1/auth/register')
      .send({ identifier: email, password: PASSWORD, displayName: 'Resend' })
      .expect(202);
    const oldCode = ctx.otp.lastCodeFor(email);
    await ctx.http.post('/v1/auth/otp/resend').send({ challengeId: reg.body.challengeId }).expect(202);
    const newCode = ctx.otp.lastCodeFor(email);
    if (oldCode !== newCode) {
      await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: reg.body.challengeId, code: oldCode }).expect(400);
    }
    await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: reg.body.challengeId, code: newCode }).expect(200);
  });

  it('resend is not blocked when the database clock is ahead of the process (cooldown 0)', async () => {
    const email = uniqueEmail();
    const reg = await ctx.http
      .post('/v1/auth/register')
      .send({ identifier: email, password: PASSWORD, displayName: 'Skew' })
      .expect(202);
    await ctx.sql.query(`UPDATE otp_challenges SET last_sent_at = now() + interval '1 hour' WHERE id = $1`, [
      reg.body.challengeId,
    ]);
    await ctx.http.post('/v1/auth/otp/resend').send({ challengeId: reg.body.challengeId }).expect(202);
  });
});

describe('login', () => {
  it('refuses an unverified account with account_not_verified (only after a correct password)', async () => {
    const email = uniqueEmail();
    await ctx.http
      .post('/v1/auth/register')
      .send({ identifier: email, password: PASSWORD, displayName: 'Pending' })
      .expect(202);
    const wrong = await ctx.http.post('/v1/auth/login').send({ identifier: email, password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    const res = await ctx.http.post('/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(403);
    expect(res.body.error.code).toBe('account_not_verified');
  });

  it('answers the same 401 for an unknown identifier and a wrong password', async () => {
    const { identifier } = await signUp(ctx);
    const a = await ctx.http.post('/v1/auth/login').send({ identifier, password: 'wrong-password-1' }).expect(401);
    const b = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier: uniqueEmail('ghost'), password: 'wrong-password-1' })
      .expect(401);
    expect(a.body.error.code).toBe('invalid_credentials');
    expect(b.body.error.code).toBe('invalid_credentials');
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks the account after 5 failures, and the lock holds even with the right password', async () => {
    const { identifier } = await signUp(ctx);
    for (let i = 0; i < 5; i++) {
      await ctx.http.post('/v1/auth/login').send({ identifier, password: `wrong-password-${i}` }).expect(401);
    }
    const res = await ctx.http.post('/v1/auth/login').send({ identifier, password: PASSWORD }).expect(423);
    expect(res.body.error.code).toBe('account_locked');

    const { rows } = await ctx.sql.query(
      `SELECT action FROM audit_events WHERE action = 'auth.account_locked'
         AND subject_user_id = (SELECT id FROM users WHERE email = $1)`,
      [identifier],
    );
    expect(rows).toHaveLength(1);
  });

  it('a suspended account cannot sign in and its existing sessions stop working', async () => {
    const { identifier, tokens } = await signUp(ctx);
    await ctx.sql.query(`UPDATE users SET status = 'suspended' WHERE email = $1`, [identifier]);
    await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(401);
    const res = await ctx.http.post('/v1/auth/login').send({ identifier, password: PASSWORD }).expect(403);
    expect(res.body.error.code).toBe('account_suspended');
    await ctx.http.post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
  });
});

describe('tokens and sessions', () => {
  it('rejects missing, malformed and tampered access tokens', async () => {
    const { tokens } = await signUp(ctx);
    await ctx.http.get('/v1/me').expect(401);
    await ctx.http.get('/v1/me').set('Authorization', 'Basic abc').expect(401);
    const [h, p, s] = tokens.accessToken.split('.');
    const tampered = `${h}.${p}.${s!.slice(0, -2)}xx`;
    await ctx.http.get('/v1/me').set(bearer(tampered)).expect(401);
  });

  it('rotates refresh tokens and revokes the session when a used token is replayed', async () => {
    const { tokens } = await signUp(ctx);
    const r1 = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(tokens.refreshToken);
    expect(r1.body.sessionId).toBe(tokens.sessionId);

    // Replay of the consumed token: treated as theft, whole session revoked.
    const replay = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
    expect(replay.body.error.code).toBe('refresh_token_invalid');
    await ctx.http.post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    await ctx.http.get('/v1/me').set(bearer(r1.body.accessToken)).expect(401);

    const { rows } = await ctx.sql.query('SELECT revoke_reason FROM sessions WHERE id = $1', [tokens.sessionId]);
    expect(rows[0].revoke_reason).toBe('refresh_token_reuse');
  });

  it('lists sessions, revokes another one remotely, and cannot touch another user’s session', async () => {
    const { identifier, tokens: phone } = await signUp(ctx);
    const laptop = await ctx.http
      .post('/v1/auth/login')
      .send({ identifier, password: PASSWORD, device: { name: 'Laptop', platform: 'web' } })
      .expect(200);

    const list = await ctx.http.get('/v1/auth/sessions').set(bearer(phone.accessToken)).expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.find((s: { current: boolean }) => s.current).id).toBe(phone.sessionId);

    const other = await signUp(ctx);
    await ctx.http
      .delete(`/v1/auth/sessions/${laptop.body.sessionId}`)
      .set(bearer(other.tokens.accessToken))
      .expect(404);
    await ctx.http.get('/v1/me').set(bearer(laptop.body.accessToken)).expect(200);

    await ctx.http
      .delete(`/v1/auth/sessions/${laptop.body.sessionId}`)
      .set(bearer(phone.accessToken))
      .expect(204);
    await ctx.http.get('/v1/me').set(bearer(laptop.body.accessToken)).expect(401);
    await ctx.http.post('/v1/auth/refresh').send({ refreshToken: laptop.body.refreshToken }).expect(401);
    await ctx.http.get('/v1/me').set(bearer(phone.accessToken)).expect(200);
  });

  it('logout ends the current session only', async () => {
    const { tokens } = await signUp(ctx);
    await ctx.http.post('/v1/auth/logout').set(bearer(tokens.accessToken)).expect(204);
    await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(401);
    await ctx.http.post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
  });
});

describe('password reset', () => {
  it('resets the password with a code and revokes every session', async () => {
    const { identifier, tokens } = await signUp(ctx);
    const forgot = await ctx.http.post('/v1/auth/password/forgot').send({ identifier }).expect(202);
    const code = ctx.otp.lastCodeFor(identifier);
    await ctx.http
      .post('/v1/auth/password/reset')
      .send({ challengeId: forgot.body.challengeId, code, newPassword: 'brand-new-password-42' })
      .expect(204);

    await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(401);
    await ctx.http.post('/v1/auth/login').send({ identifier, password: PASSWORD }).expect(401);
    await ctx.http.post('/v1/auth/login').send({ identifier, password: 'brand-new-password-42' }).expect(200);
  });

  it('keeps two-factor authentication after a reset: the new password still needs the second factor', async () => {
    const { identifier, tokens } = await signUp(ctx);
    const setup = await ctx.http.post('/v1/me/2fa/totp/setup').set(bearer(tokens.accessToken)).expect(200);
    await ctx.http
      .post('/v1/me/2fa/totp/enable')
      .set(bearer(tokens.accessToken))
      .send({ code: totp(setup.body.secret, Date.now()), password: PASSWORD })
      .expect(200);
    const forgot = await ctx.http.post('/v1/auth/password/forgot').send({ identifier }).expect(202);
    await ctx.http
      .post('/v1/auth/password/reset')
      .send({ challengeId: forgot.body.challengeId, code: ctx.otp.lastCodeFor(identifier), newPassword: 'brand-new-password-42' })
      .expect(204);
    const login = await ctx.http.post('/v1/auth/login').send({ identifier, password: 'brand-new-password-42' }).expect(200);
    expect(login.body.twoFactorRequired).toBe(true);
    expect(login.body.accessToken).toBeUndefined();
  });

  it('answers identically for an unknown identifier and sends nothing', async () => {
    const sentBefore = ctx.otp.messages.length;
    const res = await ctx.http.post('/v1/auth/password/forgot').send({ identifier: uniqueEmail('ghost') }).expect(202);
    expect(Object.keys(res.body).sort()).toEqual(['challengeId', 'channel', 'expiresAt']);
    expect(ctx.otp.messages.length).toBe(sentBefore);
  });

  it('a signup code cannot be used to reset a password', async () => {
    const email = uniqueEmail();
    const reg = await ctx.http
      .post('/v1/auth/register')
      .send({ identifier: email, password: PASSWORD, displayName: 'Mix' })
      .expect(202);
    const code = ctx.otp.lastCodeFor(email);
    await ctx.http
      .post('/v1/auth/password/reset')
      .send({ challengeId: reg.body.challengeId, code, newPassword: 'hijacked-password-1' })
      .expect(400);
  });
});
