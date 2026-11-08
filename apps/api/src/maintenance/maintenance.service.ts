import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { inArray, lt, or, sql } from 'drizzle-orm';
import type pg from 'pg';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db, PG_POOL } from '../db/db.module.js';
import { auditEvents, orgMembers, otpChallenges, refreshTokens, sessions, userBlocks } from '../db/schema.js';
import { contentUrlOf, MediaService } from '../media/media.service.js';
import { MediaStorage } from '../media/storage.js';
import { reconcile } from '../ledger/ledger.queries.js';

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
          staleUploads: await this.media.purgeStaleUploads(now),
          // After purgeDueDeletions committed: also retries what a previous run could not delete.
          deletedUserMedia: await this.purgeDeletedUsersMedia(),
        };
        // Lot 4B: not part of the result shape; logged only.
        await this.purgeOldStoryViews(now);
        // Lot 3b: disappearing messages past their expiry lose body and media, like a recall.
        await this.wipeExpiredMessages(now);
        // Lot 6A: hourly ledger reconciliation; any divergence is logged as an error.
        await this.reconcileLedger();
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
      await this.db.execute(sql`DELETE FROM message_favorites WHERE message_id = ANY(${arr})`);
      this.logger.log(`maintenance: ${ids.length} expired messages erased`);
    }
    return ids.length;
  }

  /** Views of stories that expired more than 30 days ago (the stories stay in their author's archive). */
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

      // Messaging (lot 3A): memberships become "left", message bodies and attachments are erased
      // (the rows stay so conversations keep their numbering), reactions are dropped. A group left
      // without an owner hands it to its longest-standing admin, else member.
      await tx.execute(sql`
        UPDATE conversation_members SET status = 'left', left_at = now(), role = 'member'
        WHERE user_id = ANY(${idArray}) AND status = 'active'`);
      await tx.execute(sql`UPDATE messages SET body = NULL, media_id = NULL WHERE sender_id = ANY(${idArray})`);
      await tx.execute(sql`DELETE FROM message_reactions WHERE user_id = ANY(${idArray})`);
      // Lot 3b: favourites, drafts and scheduled messages of the account.
      await tx.execute(sql`DELETE FROM message_favorites WHERE user_id = ANY(${idArray})`);
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
      // Ledger (lot 6A): postings are append-only and kept (retention); the user's accounts are frozen, never deleted.
      // A non-zero sandbox balance left on them is reported by the reconciliation/back-office, not erased.
      await tx.execute(sql`UPDATE ledger_accounts SET status = 'frozen' WHERE user_id = ANY(${idArray})`);
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
