import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { inArray, lt, or, sql } from 'drizzle-orm';
import type pg from 'pg';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db, PG_POOL } from '../db/db.module.js';
import { auditEvents, otpChallenges, refreshTokens, sessions, userBlocks } from '../db/schema.js';

/** Session-level advisory lock key; distinct from the migrator's 727372. */
export const MAINTENANCE_LOCK_KEY = 727373;
export const MAINTENANCE_INTERVAL_MS = 3_600_000;
/** First run after boot, so instances restarted more often than hourly still clean up. */
export const MAINTENANCE_STARTUP_DELAY_MS = 60_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface MaintenanceResult {
  otpChallenges: number;
  refreshTokens: number;
  sessions: number;
  /** Accounts anonymised because their deletion grace period elapsed. */
  deletedAccounts: number;
}

const ZERO: MaintenanceResult = { otpChallenges: 0, refreshTokens: 0, sessions: 0, deletedAccounts: 0 };

/**
 * Hourly cleanup of stale identity data.
 *
 * Scheduling is enabled by registering `ScheduleModule.forRoot()` in AppModule only when
 * MAINTENANCE_ENABLED is true: without that module the `@Interval` metadata is never
 * discovered, so tests and opted-out instances never start a timer. The same flag gates the
 * one-off run MAINTENANCE_STARTUP_DELAY_MS after bootstrap. `runOnce` stays callable
 * directly either way.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private startupTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.MAINTENANCE_ENABLED) return;
    // unref: a pending first run never keeps the process alive on its own.
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      void this.scheduledRun();
    }, MAINTENANCE_STARTUP_DELAY_MS).unref();
  }

  onApplicationShutdown(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
  }

  @Interval('maintenance', MAINTENANCE_INTERVAL_MS)
  async scheduledRun(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error('maintenance run failed', err instanceof Error ? err.stack : String(err));
    }
  }

  /**
   * Runs every cleanup step once. Returns zeros without doing anything when another
   * instance holds the maintenance lock.
   */
  async runOnce(now: Date = new Date()): Promise<MaintenanceResult> {
    // The advisory lock is per connection: take and release it on the same dedicated client.
    const lockClient = await this.pool.connect();
    let unlockFailed = false;
    try {
      const { rows } = await lockClient.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
        MAINTENANCE_LOCK_KEY,
      ]);
      if (!rows[0]?.locked) {
        this.logger.log('maintenance skipped: another instance holds the lock');
        return { ...ZERO };
      }
      try {
        const result: MaintenanceResult = {
          otpChallenges: await this.purgeOtpChallenges(now),
          refreshTokens: await this.purgeRefreshTokens(now),
          sessions: await this.purgeSessions(now),
          deletedAccounts: await this.purgeDueDeletions(now),
        };
        this.logger.log(
          `maintenance done: otpChallenges=${result.otpChallenges} refreshTokens=${result.refreshTokens} sessions=${result.sessions} deletedAccounts=${result.deletedAccounts}`,
        );
        return result;
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [MAINTENANCE_LOCK_KEY]).catch(() => {
          unlockFailed = true;
        });
      }
    } finally {
      // Destroy the connection if the unlock failed so the lock cannot leak back into the pool.
      lockClient.release(unlockFailed);
    }
  }

  /** OTP challenges expired for more than 24 hours. */
  private async purgeOtpChallenges(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - DAY_MS);
    const res = await this.db.delete(otpChallenges).where(lt(otpChallenges.expiresAt, cutoff));
    return res.rowCount ?? 0;
  }

  /** Refresh tokens that are expired, or were used (rotated) more than 7 days ago. */
  private async purgeRefreshTokens(now: Date): Promise<number> {
    const usedCutoff = new Date(now.getTime() - 7 * DAY_MS);
    const res = await this.db
      .delete(refreshTokens)
      .where(or(lt(refreshTokens.expiresAt, now), lt(refreshTokens.usedAt, usedCutoff)));
    return res.rowCount ?? 0;
  }

  /** Sessions revoked or expired more than 30 days ago (their refresh tokens cascade). */
  private async purgeSessions(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);
    const res = await this.db
      .delete(sessions)
      .where(or(lt(sessions.revokedAt, cutoff), lt(sessions.expiresAt, cutoff)));
    return res.rowCount ?? 0;
  }

  /**
   * Anonymises accounts whose deletion was requested more than ACCOUNT_DELETION_GRACE_DAYS ago
   * (right of erasure). The row is kept (ids stay valid for the append-only audit log) but holds
   * no personal data any more: identifiers are released so they can be registered again, the
   * password hash is unusable (argon2 verify fails, PasswordService.verify returns false), and
   * sessions (refresh tokens cascade), OTP challenges and blocks are deleted. One transaction.
   */
  private async purgeDueDeletions(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - this.env.ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
    return this.db.transaction(async (tx) => {
      const res = await tx.execute<{ id: string }>(sql`
        UPDATE users SET
          status = 'deleted',
          email = NULL,
          phone = NULL,
          handle = 'deleted_' || left(replace(id::text, '-', ''), 12),
          display_name = 'Compte supprimé',
          bio = NULL,
          avatar_url = NULL,
          country = NULL,
          email_verified_at = NULL,
          phone_verified_at = NULL,
          password_hash = '!deleted',
          roles = ARRAY['user']::text[],
          failed_login_count = 0,
          locked_until = NULL
        WHERE id IN (
          SELECT id FROM users
          WHERE deletion_requested_at < ${cutoff.toISOString()}::timestamptz AND status <> 'deleted'
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`);
      const ids = res.rows.map((r) => r.id);
      if (ids.length === 0) return 0;
      await tx.delete(sessions).where(inArray(sessions.userId, ids));
      await tx.delete(otpChallenges).where(inArray(otpChallenges.userId, ids));
      await tx.delete(userBlocks).where(or(inArray(userBlocks.blockerId, ids), inArray(userBlocks.blockedId, ids)));
      // System action: no actor. Only the id is referenced.
      await tx.insert(auditEvents).values(
        ids.map((id) => ({ action: 'user.deleted', subjectUserId: id, metadata: { reason: 'deletion_grace_elapsed' } })),
      );
      return ids.length;
    });
  }
}
