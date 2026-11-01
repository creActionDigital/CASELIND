import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAINTENANCE_LOCK_KEY, MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { createTestContext, signUp, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('maintenance', () => {
  it('deletes only stale OTP challenges, refresh tokens and sessions, then is idempotent', async () => {
    const { tokens } = await signUp(ctx);
    const owner = await ctx.sql.query<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = $1', [
      tokens.sessionId,
    ]);
    const userId = owner.rows[0]!.user_id;

    const now = new Date();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const later = (ms: number) => new Date(now.getTime() + ms);

    const insertOtp = async (expiresAt: Date): Promise<string> => {
      const { rows } = await ctx.sql.query<{ id: string }>(
        `INSERT INTO otp_challenges (user_id, purpose, channel, destination, code_hash, expires_at)
         VALUES ($1, 'signup', 'email', 'x@example.test', 'hash', $2) RETURNING id`,
        [userId, expiresAt],
      );
      return rows[0]!.id;
    };
    const insertSession = async (expiresAt: Date, revokedAt: Date | null): Promise<string> => {
      const { rows } = await ctx.sql.query<{ id: string }>(
        `INSERT INTO sessions (user_id, expires_at, revoked_at) VALUES ($1, $2, $3) RETURNING id`,
        [userId, expiresAt, revokedAt],
      );
      return rows[0]!.id;
    };
    const insertToken = async (sessionId: string, expiresAt: Date, usedAt: Date | null): Promise<string> => {
      const { rows } = await ctx.sql.query<{ id: string }>(
        `INSERT INTO refresh_tokens (session_id, token_hash, expires_at, used_at) VALUES ($1, $2, $3, $4) RETURNING id`,
        [sessionId, randomBytes(16).toString('hex'), expiresAt, usedAt],
      );
      return rows[0]!.id;
    };

    const staleOtp = await insertOtp(ago(2 * DAY));
    const recentlyExpiredOtp = await insertOtp(ago(HOUR));

    const liveSession = await insertSession(later(30 * DAY), null);
    const tokenUsedLongAgo = await insertToken(liveSession, later(20 * DAY), ago(8 * DAY));
    const tokenExpired = await insertToken(liveSession, ago(60_000), null);
    const tokenUsedYesterday = await insertToken(liveSession, later(20 * DAY), ago(DAY));
    const tokenFresh = await insertToken(liveSession, later(20 * DAY), null);

    const revokedLongAgo = await insertSession(later(DAY), ago(31 * DAY));
    // Valid token on a purged session: removed by ON DELETE CASCADE, not counted as a refresh-token purge.
    const cascadedToken = await insertToken(revokedLongAgo, later(DAY), null);
    const revokedYesterday = await insertSession(later(DAY), ago(DAY));
    const expiredLongAgo = await insertSession(ago(31 * DAY), null);
    const expiredRecently = await insertSession(ago(29 * DAY), null);

    const service = ctx.app.get(MaintenanceService);
    expect(await service.runOnce(now)).toEqual({ otpChallenges: 1, refreshTokens: 2, sessions: 2, deletedAccounts: 0 });

    const ids = async (table: string): Promise<string[]> =>
      (await ctx.sql.query<{ id: string }>(`SELECT id FROM ${table}`)).rows.map((r) => r.id);

    const otps = await ids('otp_challenges');
    expect(otps).not.toContain(staleOtp);
    expect(otps).toContain(recentlyExpiredOtp);
    expect(otps).toHaveLength(2); // + the consumed sign-up challenge (not yet expired)

    const tokensLeft = await ids('refresh_tokens');
    expect(tokensLeft).not.toContain(tokenUsedLongAgo);
    expect(tokensLeft).not.toContain(tokenExpired);
    expect(tokensLeft).not.toContain(cascadedToken);
    expect(tokensLeft).toEqual(expect.arrayContaining([tokenUsedYesterday, tokenFresh]));
    expect(tokensLeft).toHaveLength(3); // + the sign-up session's token

    const sessionsLeft = await ids('sessions');
    expect(sessionsLeft).not.toContain(revokedLongAgo);
    expect(sessionsLeft).not.toContain(expiredLongAgo);
    expect(sessionsLeft).toEqual(
      expect.arrayContaining([tokens.sessionId, liveSession, revokedYesterday, expiredRecently]),
    );
    expect(sessionsLeft).toHaveLength(4);

    expect(await service.runOnce(now)).toEqual({ otpChallenges: 0, refreshTokens: 0, sessions: 0, deletedAccounts: 0 });
  });

  it('skips the run when another instance holds the maintenance lock', async () => {
    await ctx.sql.query(
      `INSERT INTO otp_challenges (purpose, channel, destination, code_hash, expires_at)
       VALUES ('signup', 'email', 'y@example.test', 'hash', now() - interval '3 days')`,
    );
    const service = ctx.app.get(MaintenanceService);
    const holder = await ctx.sql.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1)', [MAINTENANCE_LOCK_KEY]);
      expect(await service.runOnce()).toEqual({ otpChallenges: 0, refreshTokens: 0, sessions: 0, deletedAccounts: 0 });
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1)', [MAINTENANCE_LOCK_KEY]);
      holder.release();
    }
    expect((await service.runOnce()).otpChallenges).toBe(1);
  });
});
