import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { countMaintenanceRun } from '../observability/metrics.js';
import { inArray, lt, or, sql } from 'drizzle-orm';
import type pg from 'pg';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db, PG_POOL } from '../db/db.module.js';
import { auditEvents, orgMembers, otpChallenges, refreshTokens, sessions, userBlocks } from '../db/schema.js';
import { contentUrlOf, MediaService } from '../media/media.service.js';
import { MediaStorage } from '../media/storage.js';
import { reconcile } from '../ledger/ledger.queries.js';
import { BatchesService } from '../inventory-ops/batches.service.js';
import { MoneyRequestsService } from '../wallet-finance/money-requests.service.js';
import { SavingsService } from '../wallet-finance/savings.service.js';
import { ScheduledPaymentsService } from '../wallet-finance/scheduled-payments.service.js';
import { FeesService } from '../school/fees.service.js';
import { WebhookService } from '../webhooks/webhooks.service.js';
import { MiniAppRevenueService } from '../miniapps/miniapp-revenue.service.js';
import { MiniAppWebhookService } from '../miniapps/miniapp-webhook.service.js';
import { AnnouncementsService } from '../platform-ops/announcements.service.js';
import { SanctionsService } from '../platform-ops/sanctions.service.js';

/** Media of deleted accounts removed per maintenance run (files first, then rows); the rest waits for the next run. */
const DELETED_USER_MEDIA_BATCH = 500;

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
  /** Media uploads never completed or refused, older than 24 hours (with their files). */
  staleUploads: number;
  /** Media assets of deleted accounts removed (stored file, then row). */
  deletedUserMedia: number;
}

const ZERO: MaintenanceResult = {
  otpChallenges: 0,
  refreshTokens: 0,
  sessions: 0,
  deletedAccounts: 0,
  staleUploads: 0,
  deletedUserMedia: 0,
};

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
    private readonly media: MediaService,
    private readonly storage: MediaStorage,
    private readonly schoolFees: FeesService,
    private readonly webhooks: WebhookService,
    private readonly batches: BatchesService,
    private readonly moneyRequests: MoneyRequestsService,
    private readonly scheduledPayments: ScheduledPaymentsService,
    private readonly savings: SavingsService,
    private readonly miniappHooks: MiniAppWebhookService,
    private readonly miniappRevenue: MiniAppRevenueService,
    private readonly sanctions: SanctionsService,
    private readonly announcements: AnnouncementsService,
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
      countMaintenanceRun('success');
    } catch (err) {
      countMaintenanceRun('failure');
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
          staleUploads: await this.media.purgeStaleUploads(now),
          // After purgeDueDeletions committed: also retries what a previous run could not delete.
          deletedUserMedia: await this.purgeDeletedUsersMedia(),
        };
        // Lot 4B: not part of the result shape; logged only.
        await this.purgeOldStoryViews(now);
        // Retention: assistant action log (12 months), daily active-user counter (400 days), administrator requests past their deadline marked expired.
        await this.purgeRetention().catch((err: unknown) => this.logger.error(`retention purge failed: ${(err as Error).name}`));
        // Creator tools: impression de-duplication rows (8 days), old daily counters, boosts past their end.
        await this.tidyCreatorData(now).catch((err: unknown) => this.logger.error(`creator data cleanup failed: ${(err as Error).name}`));
        // Mini-app platform: access log (90 days) and daily usage counters (400 days).
        await this.purgeMiniAppData(now).catch((err: unknown) => this.logger.error(`mini-app data purge failed: ${(err as Error).name}`));
        // On-demand courier: open requests past their deadline become expired (they already read as expired before this runs).
        await this.expireCourierRequests(now).catch((err: unknown) => this.logger.error(`courier request expiry failed: ${(err as Error).name}`));
        // Carpooling and roadside assistance: past trips are closed, open roadside requests past their deadline expire.
        await this.expireMobilityExtra(now).catch((err: unknown) => this.logger.error(`carpool/roadside expiry failed: ${(err as Error).name}`));
        // Lot 3b: disappearing messages past their expiry lose body and media, like a recall.
        await this.wipeExpiredMessages(now);
        // Lot 6A: hourly ledger reconciliation; any divergence is logged as an error.
        await this.reconcileLedger();
        // Lot 17b: school fees due within 3 days (once per fee, generic notification); never fails the run.
        await this.schoolFees.remindDue(now).catch((err: unknown) => this.logger.error(`school fee reminders failed: ${(err as Error).name}`));
        // Lots: expiry alerts (within 7 days, then expired), once per batch and threshold; never fails the run.
        await this.batches.notifyExpiring(now).catch((err: unknown) => this.logger.error(`batch expiry alerts failed: ${(err as Error).name}`));
        // Wallet finance (test funds): expired money requests, due scheduled payments (resilient, idempotent per run), savings deadline reminders; never fail the run.
        await this.moneyRequests.expireDue().catch((err: unknown) => this.logger.error(`money request expiry failed: ${(err as Error).name}`));
        await this.scheduledPayments.runDue(now).catch((err: unknown) => this.logger.error(`scheduled payments failed: ${(err as Error).name}`));
        await this.savings.remindDeadlines().catch((err: unknown) => this.logger.error(`savings reminders failed: ${(err as Error).name}`));
        // Webhooks: retries that are due, then the journal bound (100 per subscription); never fails the run.
        await this.webhooks.processDue().catch((err: unknown) => this.logger.error(`webhook retries failed: ${(err as Error).name}`));
        await this.webhooks.purge().catch((err: unknown) => this.logger.error(`webhook journal purge failed: ${(err as Error).name}`));
        // Mini-app events: retries and journal bound; indicative revenue statements (previous month closed, current month open).
        await this.miniappHooks.processDue().catch((err: unknown) => this.logger.error(`mini-app webhook retries failed: ${(err as Error).name}`));
        await this.miniappHooks.purge().catch((err: unknown) => this.logger.error(`mini-app webhook journal purge failed: ${(err as Error).name}`));
        await this.miniappRevenue.runMaintenance(now).catch((err: unknown) => this.logger.error(`mini-app revenue statements failed: ${(err as Error).name}`));
        // Sanctions past their end expire (a suspension lifts itself); announcements end / are notified when their period begins.
        await this.sanctions.expireDue().catch((err: unknown) => this.logger.error(`sanction expiry failed: ${(err as Error).name}`));
        await this.announcements.runMaintenance().catch((err: unknown) => this.logger.error(`announcements maintenance failed: ${(err as Error).name}`));
        this.logger.log(
          `maintenance done: otpChallenges=${result.otpChallenges} refreshTokens=${result.refreshTokens} sessions=${result.sessions} deletedAccounts=${result.deletedAccounts} staleUploads=${result.staleUploads} deletedUserMedia=${result.deletedUserMedia}`,
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

  /** Compares cached balances with the postings; logs every divergence (never throws). */
  private async reconcileLedger(): Promise<void> {
    try {
      const r = await reconcile(this.db);
      if (!r.ok) {
        this.logger.error(
          `ledger reconciliation FAILED: ${r.divergences.length} account divergence(s) ${JSON.stringify(r.divergences)}, currency totals ${JSON.stringify(r.currencyTotals)}`,
        );
      }
    } catch (err) {
      this.logger.error('ledger reconciliation could not run', err instanceof Error ? err.stack : String(err));
    }
  }

  /** Lot 3b: body, media and mentions of expired messages are erased (the rows stay so numbering holds); reactions and favourites go. */
  private async wipeExpiredMessages(now: Date): Promise<number> {
    const res = await this.db.execute<{ id: string }>(sql`
      UPDATE messages SET body = NULL, media_id = NULL, mentions = '{}'
      WHERE expires_at IS NOT NULL AND expires_at <= ${now.toISOString()}::timestamptz
        AND (body IS NOT NULL OR media_id IS NOT NULL OR cardinality(mentions) > 0)
      RETURNING id`);
    const ids = res.rows.map((r) => r.id);
    if (ids.length > 0) {
      const arr = sql`ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`;
      await this.db.execute(sql`DELETE FROM message_reactions WHERE message_id = ANY(${arr})`);
      await this.db.execute(sql`DELETE FROM message_translations WHERE message_id = ANY(${arr})`);
      await this.db.execute(sql`DELETE FROM message_favorites WHERE message_id = ANY(${arr})`);
      await this.db.execute(sql`DELETE FROM message_polls WHERE message_id = ANY(${arr})`);
      this.logger.log(`maintenance: ${ids.length} expired messages erased`);
    }
    return ids.length;
  }

  /** Courier requests nobody accepted before `expires_at` (30 minutes, or 30 minutes after the slot). */
  /**
   * Carpooling: a trip nobody marked as departed, 3 hours after its time, is cancelled (its live bookings with it);
   * a departed trip nobody completed, 24 hours after, is completed. Roadside: open requests past `expires_at` expire.
   */
  private async expireMobilityExtra(now: Date): Promise<number> {
    const at = now.toISOString();
    await this.db.execute(sql`
      UPDATE carpool_bookings SET status = CASE WHEN status = 'requested' THEN 'declined' ELSE 'cancelled' END, updated_at = now()
      WHERE status IN ('requested', 'accepted')
        AND trip_id IN (SELECT id FROM carpool_trips WHERE status IN ('open', 'full') AND departs_at + interval '3 hours' <= ${at}::timestamptz)`);
    const cancelled = await this.db.execute(sql`UPDATE carpool_trips SET status = 'cancelled' WHERE status IN ('open', 'full') AND departs_at + interval '3 hours' <= ${at}::timestamptz`);
    await this.db.execute(sql`
      UPDATE carpool_bookings SET status = 'completed', updated_at = now()
      WHERE status = 'accepted' AND trip_id IN (SELECT id FROM carpool_trips WHERE status = 'departed' AND departs_at + interval '24 hours' <= ${at}::timestamptz)`);
    const completed = await this.db.execute(sql`UPDATE carpool_trips SET status = 'completed' WHERE status = 'departed' AND departs_at + interval '24 hours' <= ${at}::timestamptz`);
    const roadside = await this.db.execute(sql`UPDATE roadside_requests SET status = 'expired' WHERE status = 'requested' AND expires_at <= ${at}::timestamptz`);
    // Rental requests nobody answered before the start day are closed ('cancelled': the status check has no 'expired').
    const rentals = await this.db.execute(sql`UPDATE rental_bookings SET status = 'cancelled', updated_at = now() WHERE status = 'requested' AND starts_on < ${at.slice(0, 10)}::date`);
    const n = (cancelled.rowCount ?? 0) + (completed.rowCount ?? 0) + (roadside.rowCount ?? 0) + (rentals.rowCount ?? 0);
    if (n > 0) this.logger.log(`maintenance: ${n} carpool trips / roadside requests closed`);
    return n;
  }

  private async expireCourierRequests(now: Date): Promise<number> {
    const res = await this.db.execute(sql`
      UPDATE courier_requests SET status = 'expired' WHERE status = 'requested' AND expires_at <= ${now.toISOString()}::timestamptz`);
    const n = res.rowCount ?? 0;
    if (n > 0) this.logger.log(`maintenance: ${n} courier requests expired`);
    return n;
  }

  /** Reads of user data by mini-apps older than 90 days; per-app daily counters (no user data) older than 400 days. */
  private async purgeMiniAppData(now: Date): Promise<void> {
    const iso = (days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString();
    await this.db.execute(sql`DELETE FROM miniapp_access_log WHERE at < ${iso(90)}::timestamptz`);
    await this.db.execute(sql`DELETE FROM miniapp_usage_daily WHERE day < ${iso(400)}::date`);
    await this.db.execute(sql`DELETE FROM miniapp_notify_daily WHERE day < ${iso(3)}::date`);
  }

  /** Impression de-duplication hashes older than 8 days, daily counters older than 120 days, boosts whose end passed become `ended`. */
  private async tidyCreatorData(now: Date): Promise<void> {
    const iso = (days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString();
    await this.db.execute(sql`DELETE FROM post_impression_viewers WHERE day < ${iso(8)}::date`);
    await this.db.execute(sql`DELETE FROM post_impressions WHERE day < ${iso(120)}::date`);
    await this.db.execute(sql`UPDATE post_boosts SET status = 'ended' WHERE status = 'active' AND ends_at <= ${now.toISOString()}::timestamptz`);
  }

  /** Views of stories that expired more than 30 days ago (the stories stay in their author's archive). */
  private async purgeRetention(): Promise<void> {
    await this.db.execute(sql`DELETE FROM ai_action_log WHERE created_at < now() - interval '12 months'`);
    await this.db.execute(sql`DELETE FROM user_active_days WHERE day < current_date - 400`);
    await this.db.execute(sql`UPDATE admin_approvals SET status = 'expired' WHERE status = 'pending' AND expires_at <= now()`);
  }

  private async purgeOldStoryViews(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);
    const res = await this.db.execute(sql`
      DELETE FROM story_views WHERE story_id IN (SELECT id FROM stories WHERE expires_at < ${cutoff.toISOString()}::timestamptz)`);
    const n = res.rowCount ?? 0;
    if (n > 0) this.logger.log(`maintenance: ${n} expired story views removed`);
    return n;
  }

  /** OTP challenges expired for more than 24 hours. */
  private async purgeOtpChallenges(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - DAY_MS);
    const res = await this.db.delete(otpChallenges).where(lt(otpChallenges.expiresAt, cutoff));
    // Lot 1c: expired 2FA login challenges and QR login sessions follow the same retention.
    const extra = await this.db.execute(sql`
      WITH a AS (DELETE FROM two_factor_challenges WHERE expires_at < ${cutoff.toISOString()}::timestamptz RETURNING 1),
           b AS (DELETE FROM qr_login_sessions WHERE expires_at < ${cutoff.toISOString()}::timestamptz RETURNING 1)
      SELECT (SELECT count(*) FROM a)::int AS a, (SELECT count(*) FROM b)::int AS b`);
    void extra;
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
   * sessions (refresh tokens cascade), OTP challenges, blocks and organisation memberships
   * (active and invited) are deleted. One transaction.
   *
   * Organisations: the deletion request is refused while the user is the last owner (409), but an
   * org can still end up owner-less here (e.g. it was suspended at request time, or ownership
   * changed through a path outside the API). Such an org is suspended and audited as
   * `org.suspended_orphaned` so platform support can hand it over; it is never deleted.
   * Locking: the orgs the candidates actively own are locked FOR UPDATE (id order) BEFORE the user
   * rows, the same org -> user order as OrgMembersService and AccountService.requestDeletion.
   *
   * Media rows and files are NOT removed here: purgeDeletedUsersMedia does it after this commits
   * (file I/O must not run inside a DB transaction, and it retries on the next run on failure).
   */
  private async purgeDueDeletions(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - this.env.ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
    return this.db.transaction(async (tx) => {
      // The consent journal refuses DELETE/TRUNCATE (trigger of 0100) unless this transaction is the account purge.
      await tx.execute(sql`SET LOCAL caselind.purge = 'on'`);
      const candidates = await tx.execute<{ id: string }>(sql`
        SELECT id FROM users
        WHERE deletion_requested_at < ${cutoff.toISOString()}::timestamptz AND status <> 'deleted'`);
      const candidateIds = candidates.rows.map((r) => r.id);
      if (candidateIds.length === 0) return 0;
      const candidateArray = sql`ARRAY[${sql.join(
        candidateIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`;
      await tx.execute(sql`
        SELECT id FROM organizations
        WHERE id IN (
          SELECT org_id FROM org_members
          WHERE user_id = ANY(${candidateArray}) AND role = 'owner' AND status = 'active'
        )
        ORDER BY id
        FOR UPDATE`);

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
          WHERE id = ANY(${candidateArray})
            AND deletion_requested_at < ${cutoff.toISOString()}::timestamptz AND status <> 'deleted'
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`);
      const ids = res.rows.map((r) => r.id);
      if (ids.length === 0) return 0;
      const idArray = sql`ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`;

      // Orgs whose only active owners are being purged now (one row per org, the first such owner).
      const orphans = await tx.execute<{ org_id: string; user_id: string; status: string }>(sql`
        SELECT DISTINCT ON (m.org_id) m.org_id, m.user_id, o.status
        FROM org_members m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = ANY(${idArray}) AND m.role = 'owner' AND m.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM org_members m2
            WHERE m2.org_id = m.org_id AND m2.role = 'owner' AND m2.status = 'active'
              AND NOT (m2.user_id = ANY(${idArray}))
          )
        ORDER BY m.org_id, m.user_id`);
      await tx.delete(orgMembers).where(inArray(orgMembers.userId, ids));
      // HR: the account's profile, leaves, shifts and salary lines are erased (salary with the account); references to it elsewhere are cleared.
      // Sanctions received and appeals filed (personal data of the account) go with it.
      await tx.execute(sql`DELETE FROM user_sanctions WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM salary_register WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM work_shifts WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM leave_requests WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM employee_profiles WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`UPDATE employee_profiles SET manager_user_id = NULL WHERE manager_user_id = ANY(${idArray})`);
      await tx.execute(sql`UPDATE leave_requests SET decided_by = NULL WHERE decided_by = ANY(${idArray})`);
      await tx.execute(sql`UPDATE salary_register SET recorded_by = NULL WHERE recorded_by = ANY(${idArray})`);

      // Messaging (lot 3A): memberships become "left", message bodies and attachments are erased
      // (the rows stay so conversations keep their numbering), reactions are dropped. A group left
      // without an owner hands it to its longest-standing admin, else member.
      await tx.execute(sql`
        UPDATE conversation_members SET status = 'left', left_at = now(), role = 'member'
        WHERE user_id = ANY(${idArray}) AND status = 'active'`);
      await tx.execute(sql`DELETE FROM message_translations WHERE message_id IN (SELECT id FROM messages WHERE sender_id = ANY(${idArray}))`);
      await tx.execute(sql`UPDATE messages SET body = NULL, media_id = NULL WHERE sender_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM message_reactions WHERE user_id = ANY(${idArray})`);
      // Lot 3b: favourites, drafts and scheduled messages of the account.
      await tx.execute(sql`DELETE FROM message_favorites WHERE user_id = ANY(${idArray})`);
      // Polls the account created are erased with their votes (the question was its message body); its own votes go.
      await tx.execute(sql`DELETE FROM message_polls WHERE creator_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM message_poll_votes WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM conversation_drafts WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM scheduled_messages WHERE sender_id = ANY(${idArray})`);
      await tx.execute(sql`
        UPDATE conversation_members cm SET role = 'owner'
        WHERE (cm.conversation_id, cm.user_id) IN (
          SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.user_id
          FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id AND c.kind = 'group'
          WHERE m.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM conversation_members o
              WHERE o.conversation_id = m.conversation_id AND o.status = 'active' AND o.role = 'owner')
          ORDER BY m.conversation_id, (m.role = 'admin') DESC, m.joined_at, m.user_id)`);
      if (orphans.rows.length > 0) {
        await tx.execute(sql`
          UPDATE organizations SET status = 'suspended'
          WHERE id = ANY(ARRAY[${sql.join(
            orphans.rows.map((o) => sql`${o.org_id}`),
            sql`, `,
          )}]::uuid[])`);
        await tx.insert(auditEvents).values(
          orphans.rows.map((o) => ({
            action: 'org.suspended_orphaned',
            subjectUserId: o.user_id,
            metadata: { orgId: o.org_id, previousStatus: o.status, reason: 'last_owner_deleted' },
          })),
        );
      }

      // Stories (lot 4B): rows and views go (files follow through purgeDeletedUsersMedia); views they made too;
      // reports they filed are kept, anonymised.
      await tx.execute(sql`DELETE FROM stories WHERE author_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM story_views WHERE viewer_id = ANY(${idArray})`);
      await tx.execute(sql`UPDATE reports SET reporter_id = NULL, details = NULL WHERE reporter_id = ANY(${idArray})`);
      // Social (lot 4A): follows and reactions are dropped, posts and comments are deleted.
      await tx.execute(sql`DELETE FROM follows WHERE follower_id = ANY(${idArray}) OR followee_id = ANY(${idArray})`);
      // Lot 7: search history and its setting are personal data.
      await tx.execute(sql`DELETE FROM search_history WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM search_settings WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM post_reactions WHERE user_id = ANY(${idArray})`);
      // Commerce (lot 5B): the cart and the reviews go; orders stay for the seller accounting with the address erased.
      await tx.execute(sql`DELETE FROM cart_items WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM wishlist_items WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM post_bookmarks WHERE user_id = ANY(${idArray})`); // their posts, boosts, tags and counters go with the posts
      await tx.execute(sql`DELETE FROM reviews WHERE user_id = ANY(${idArray})`);
      // Services (lot 9): reviews, booking notes and the provider profile go; live bookings are cancelled by the system and
      // the offers of an individual provider are archived (bookings and offers of organisations are not personal data of the user).
      await tx.execute(sql`DELETE FROM service_reviews WHERE client_id = ANY(${idArray})`);
      await tx.execute(sql`UPDATE service_bookings SET note = NULL WHERE client_id = ANY(${idArray}) AND note IS NOT NULL`);
      await tx.execute(sql`
        UPDATE service_bookings SET status = 'cancelled', status_changed_at = now(), status_changed_by = 'system', updated_at = now()
        WHERE status IN ('requested', 'confirmed')
          AND (client_id = ANY(${idArray}) OR offer_id IN (SELECT id FROM service_offers WHERE provider_id = ANY(${idArray})))`);
      await tx.execute(sql`UPDATE service_offers SET status = 'archived', updated_at = now() WHERE provider_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM service_providers WHERE user_id = ANY(${idArray})`);
      // Mini-apps (lot 10): authorizations, codes and tokens go; pending payment requests are cancelled (paid ones stay with the ledger).
      await tx.execute(sql`UPDATE miniapp_payment_requests SET status = 'cancelled', decided_at = now() WHERE user_id = ANY(${idArray}) AND status = 'pending'`);
      await tx.execute(sql`DELETE FROM miniapp_tokens WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM miniapp_auth_codes WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM miniapp_grants WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM miniapp_access_log WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM miniapp_notify_daily WHERE user_id = ANY(${idArray})`);
      // Mobility (lot 11): favourite places, trusted contacts (both directions), quick messages, ratings' text and the driver
      // profile go; live rides are cancelled by the system; addresses of past rides are erased (distance and fare are kept).
      await tx.execute(sql`DELETE FROM mobility_favorite_places WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM mobility_trusted_contacts WHERE user_id = ANY(${idArray}) OR contact_user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM mobility_ride_messages WHERE sender_id = ANY(${idArray}) OR ride_id IN (SELECT id FROM mobility_rides WHERE rider_id = ANY(${idArray}) OR driver_id = ANY(${idArray}))`);
      await tx.execute(sql`UPDATE mobility_ride_ratings SET comment = NULL WHERE rater_id = ANY(${idArray}) OR ratee_id = ANY(${idArray})`);
      await tx.execute(sql`
        UPDATE mobility_rides SET status = CASE WHEN rider_id = ANY(${idArray}) THEN 'cancelled_by_rider' ELSE 'cancelled_by_driver' END,
          cancel_reason = 'other', cancelled_at = now(), updated_at = now()
        WHERE status IN ('scheduled', 'requested', 'accepted', 'driver_arriving', 'in_progress') AND (rider_id = ANY(${idArray}) OR driver_id = ANY(${idArray}))`);
      await tx.execute(sql`
        UPDATE mobility_rides SET pickup_lat = 0, pickup_lng = 0, pickup_label = '', dropoff_lat = 0, dropoff_lng = 0, dropoff_label = '',
          stop_lat = NULL, stop_lng = NULL, stop_label = NULL, track_lat = NULL, track_lng = NULL, share_hash = NULL
        WHERE rider_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM mobility_drivers WHERE user_id = ANY(${idArray})`);
      // Roadside assistance: a provider who leaves hands the request back to the open list (position and consent erased).
      await tx.execute(sql`
        UPDATE roadside_requests SET status = 'requested', provider_id = NULL, eta_minutes = NULL, accepted_at = NULL, location_consent = false, last_lat = NULL, last_lng = NULL, last_location_at = NULL
        WHERE provider_id = ANY(${idArray}) AND status IN ('accepted', 'on_the_way')`);
      // On-demand courier: a courier who leaves hands an accepted request back to the open list (under way: cancelled) and loses
      // their position; a requester who leaves cancels the live requests, and addresses, coordinates and notes are erased.
      await tx.execute(sql`
        UPDATE courier_requests SET status = CASE WHEN status = 'accepted' THEN 'requested' ELSE 'cancelled' END,
          cancelled_at = CASE WHEN status = 'accepted' THEN NULL ELSE now() END,
          expires_at = CASE WHEN status = 'accepted' THEN now() + interval '30 minutes' ELSE expires_at END,
          accepted_at = NULL, courier_id = NULL, location_consent = false, last_lat = NULL, last_lng = NULL, last_location_at = NULL
        WHERE courier_id = ANY(${idArray}) AND status IN ('accepted', 'picked_up')`);
      await tx.execute(sql`
        UPDATE courier_requests SET status = 'cancelled', cancelled_at = now(), location_consent = false, last_lat = NULL, last_lng = NULL, last_location_at = NULL
        WHERE requester_id = ANY(${idArray}) AND status IN ('requested', 'accepted', 'picked_up')`);
      await tx.execute(sql`
        UPDATE courier_requests SET pickup_lat = 0, pickup_lng = 0, pickup_label = '', dropoff_lat = 0, dropoff_lng = 0, dropoff_label = '', note = NULL
        WHERE requester_id = ANY(${idArray})`);
      // AI assistant (lot 12): private conversations (messages cascade), settings and usage counters go.
      await tx.execute(sql`DELETE FROM ai_conversations WHERE user_id = ANY(${idArray})`); // proposed actions cascade
      await tx.execute(sql`DELETE FROM ai_actions WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM ai_action_log WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM ai_user_settings WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM ai_usage_daily WHERE user_id = ANY(${idArray})`);
      // Ledger (lot 6A): postings are append-only and kept (retention); the user's accounts are frozen, never deleted.
      // A non-zero sandbox balance left on them is reported by the reconciliation/back-office, not erased.
      await tx.execute(sql`UPDATE ledger_accounts SET status = 'frozen' WHERE user_id = ANY(${idArray})`);
      // Savings pools (system accounts 'savings:<userId>') are frozen the same way.
      await tx.execute(sql`UPDATE ledger_accounts SET status = 'frozen' WHERE system_code = ANY(SELECT 'savings:' || x::text FROM unnest(${idArray}) AS x)`);
      // Delivery (lot 8): a courier who leaves loses their open deliveries (not picked up: back to the seller queue;
      // under way: failed), their position goes; as a buyer the position, the rating text and the failure text are erased.
      // Events are append-only and keep no personal text beyond the actor id of the (anonymised) account.
      await tx.execute(sql`
        INSERT INTO delivery_events (delivery_id, kind, from_status, status, actor_kind, note)
        SELECT id, 'status', status, CASE WHEN status = 'assigned' THEN 'pending' ELSE 'failed' END, 'system', 'courier_removed'
        FROM deliveries WHERE courier_id = ANY(${idArray}) AND status IN ('assigned', 'picked_up', 'in_transit')`);
      await tx.execute(sql`
        UPDATE deliveries SET
          failure_reason = CASE WHEN status = 'assigned' THEN failure_reason ELSE 'courier_removed' END,
          status = CASE WHEN status = 'assigned' THEN 'pending' ELSE 'failed' END,
          courier_id = CASE WHEN status = 'assigned' THEN NULL ELSE courier_id END,
          assigned_at = CASE WHEN status = 'assigned' THEN NULL ELSE assigned_at END,
          last_lat = NULL, last_lng = NULL, last_location_at = NULL, location_consent = false
        WHERE courier_id = ANY(${idArray}) AND status IN ('assigned', 'picked_up', 'in_transit')`);
      await tx.execute(sql`
        UPDATE deliveries SET last_lat = NULL, last_lng = NULL, last_location_at = NULL, location_consent = false,
          rating_comment = CASE WHEN buyer_id = ANY(${idArray}) THEN NULL ELSE rating_comment END
        WHERE buyer_id = ANY(${idArray}) OR courier_id = ANY(${idArray})`);
      await tx.execute(sql`UPDATE orders SET address = NULL, address_anonymized_at = now() WHERE buyer_id = ANY(${idArray}) AND address IS NOT NULL`);
      // Returns stay for the seller accounting (statuses, amounts); the free text the user wrote is erased.
      await tx.execute(sql`UPDATE order_returns SET details = NULL, dispute_reason = NULL WHERE requested_by = ANY(${idArray})`);
      // Posts and comments are erased for good (bodies included; reactions, media links and replies cascade).
      await tx.execute(sql`DELETE FROM post_comments WHERE author_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM posts WHERE author_id = ANY(${idArray})`);
      // KYC and payment PIN (lot 6B): declared identity, encrypted number and PIN go; the decisions stay in the audit trail.
      // The identity files are media rows of the user, removed with the rest by purgeDeletedUsersMedia.
      await tx.execute(sql`DELETE FROM kyc_submissions WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM kyc_profiles WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM payment_pins WHERE user_id = ANY(${idArray})`);
      // Lot 1c: TOTP secret, backup codes, pending 2FA challenges and QR approvals go with the account.
      await tx.execute(sql`DELETE FROM user_totp WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM user_backup_codes WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM two_factor_challenges WHERE user_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM qr_login_sessions WHERE approved_by = ANY(${idArray})`);
      await tx.delete(sessions).where(inArray(sessions.userId, ids));
      await tx.delete(otpChallenges).where(inArray(otpChallenges.userId, ids));
      await tx.delete(userBlocks).where(or(inArray(userBlocks.blockerId, ids), inArray(userBlocks.blockedId, ids)));
      // Lots 13+ (right to erasure, docs/POLITIQUE_PURGE_COMPTES.md). The user row stays, so ON DELETE CASCADE never
      // fires: every table owned by the account is deleted here. Children go before parents.
      // A. owner/author rows are deleted.
      for (const [table, cols] of [
        ['live_messages', ['user_id']],
        ['live_viewers', ['user_id']],
        ['lives', ['host_id']],
        ['calls', ['caller_id', 'callee_id']],
        ['push_tokens', ['user_id']],
        ['notifications', ['user_id']],
        ['notification_preferences', ['user_id']],
        ['message_hidden', ['user_id']],
        ['community_bans', ['user_id']],
        ['budgets', ['user_id']],
        ['listing_offers', ['buyer_id']],
        ['listing_visits', ['visitor_id']],
        ['listing_alerts', ['user_id']],
        ['listings', ['owner_id']],
        ['job_alerts', ['user_id']],
        ['job_interviews', ['proposed_by']],
        ['job_applications', ['user_id']],
        ['job_profiles', ['user_id']],
        ['freelance_profiles', ['user_id']],
        ['course_reviews', ['user_id']],
        ['org_reviews', ['user_id']],
        ['org_questions', ['asker_user_id']],
        ['course_enrollments', ['user_id']],
        ['exam_sessions', ['user_id']],
        ['certificates', ['user_id']],
        ['courses', ['author_id']],
        ['health_consents', ['user_id']],
        ['health_entries', ['user_id']],
        ['health_reminders', ['user_id']],
        ['health_doses', ['user_id']],
        ['health_shares', ['patient_id']],
        ['health_access_log', ['patient_id', 'accessor_id']],
        ['health_prescriptions', ['patient_id']],
        ['health_results', ['user_id']],
        ['health_appointments', ['patient_id', 'professional_id']],
        ['health_professionals', ['user_id']],
        ['game_sessions', ['user_id']],
        ['school_enrollments', ['user_id']],
        ['school_fee_payments', ['user_id']],
        ['school_guardians', ['student_user_id', 'guardian_user_id']],
        ['loyalty_movements', ['user_id']],
        ['marketing_consents', ['user_id']],
        ['user_consents', ['user_id']],
        ['user_active_days', ['user_id']],
        // Wallet finance (test funds): children (shares, runs, movements) go by ON DELETE CASCADE.
        ['money_requests', ['requester_id', 'payer_id']],
        ['split_bill_shares', ['user_id']],
        ['split_bills', ['creator_id']],
        ['scheduled_payments', ['owner_id', 'recipient_id']],
        ['savings_goals', ['user_id']],
        ['wallet_alerts', ['user_id']],
        // Carpooling (ratings and bookings of others on a deleted driver's trips go with the trip by ON DELETE CASCADE),
        // vehicle rentals as a renter, roadside requests as a requester.
        ['carpool_ratings', ['rater_id', 'ratee_id']],
        ['carpool_bookings', ['passenger_id']],
        ['carpool_trips', ['driver_id']],
        ['rental_bookings', ['renter_id']],
        ['roadside_requests', ['requester_id']],
      ] as const) {
        const cond = sql.join(
          cols.map((c) => sql`${sql.identifier(c)} = ANY(${idArray})`),
          sql` OR `,
        );
        await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${cond}`);
      }
      // B. agreements with a counterparty are kept; the free text the deleted user wrote is neutralised
      // (title/reason have a 3 / 5 character minimum).
      await tx.execute(sql`UPDATE missions SET title = '[supprimé]', description = '' WHERE client_id = ANY(${idArray})`);
      await tx.execute(sql`UPDATE mission_proposals SET message = '' WHERE freelancer_id = ANY(${idArray})`);
      await tx.execute(sql`UPDATE freelance_reviews SET body = '' WHERE reviewer_id = ANY(${idArray})`);
      await tx.execute(sql`UPDATE contract_disputes SET reason = '[supprimé]' WHERE opened_by = ANY(${idArray})`);
      // C. kept as is: coupons, coupon_redemptions (usage counter tied to kept orders), journal_entries, miniapps,
      // ai_model_settings, job_postings, business_documents, school_announcements, school_fees, marketing_campaigns.
      // System action: no actor. Only the id is referenced.
      await tx.insert(auditEvents).values(
        ids.map((id) => ({ action: 'user.deleted', subjectUserId: id, metadata: { reason: 'deletion_grace_elapsed' } })),
      );
      return ids.length;
    });
  }

  /**
   * Deletes the media of deleted (anonymised) accounts: for each asset the stored file first, then
   * the row, together with any organisation logo/banner that pointed at it. Order chosen for
   * safety: a row is only removed once its file is gone, so a storage failure (logged, not fatal)
   * leaves the row in place and the next run retries it; the reverse order would leave unreachable
   * orphan files with no record of them. Between the two steps the content route answers 404
   * (file missing), which is the intended end state anyway. Avatars were already cleared by the
   * anonymisation. Runs outside any transaction; bounded per run by DELETED_USER_MEDIA_BATCH.
   */
  private async purgeDeletedUsersMedia(): Promise<number> {
    const { rows } = await this.db.execute<{ id: string; storage_key: string }>(sql`
      SELECT m.id, m.storage_key FROM media_assets m JOIN users u ON u.id = m.owner_user_id
      WHERE u.status = 'deleted'
        OR EXISTS (SELECT 1 FROM delivery_proofs p JOIN deliveries d ON d.id = p.delivery_id JOIN users b ON b.id = d.buyer_id WHERE p.media_id = m.id AND b.status = 'deleted')
      ORDER BY m.id
      LIMIT ${DELETED_USER_MEDIA_BATCH}`);
    const removable: string[] = [];
    for (const asset of rows) {
      try {
        await this.storage.delete(asset.storage_key);
        removable.push(asset.id);
      } catch (err) {
        this.logger.error(
          `could not delete a stored media object of a deleted account (asset ${asset.id}); retrying next run`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    if (removable.length === 0) return 0;
    const urls = removable.map((id) => contentUrlOf(id));
    return this.db.transaction(async (tx) => {
      const urlArray = sql`ARRAY[${sql.join(
        urls.map((u) => sql`${u}`),
        sql`, `,
      )}]::text[]`;
      await tx.execute(sql`UPDATE organizations SET logo_url = NULL WHERE logo_url = ANY(${urlArray})`);
      await tx.execute(sql`UPDATE organizations SET banner_url = NULL WHERE banner_url = ANY(${urlArray})`);
      const res = await tx.execute(sql`
        DELETE FROM media_assets WHERE id = ANY(ARRAY[${sql.join(
          removable.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[])`);
      return res.rowCount ?? 0;
    });
  }
}
