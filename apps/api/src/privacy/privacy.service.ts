import { Inject, Injectable } from '@nestjs/common';
import {
  type BlockedUser,
  type BlockList,
  type BlockListQuery,
  ErrorCodes,
  type PrivacySettings,
  type UpdatePrivacyRequest,
} from '@caselind/contracts';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { follows, userBlocks, users } from '../db/schema.js';

/** Any syntactically valid UUID (what Postgres accepts); anything else cannot name a user. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque block-list cursor: the last row's (created_at, blocked_id), full microsecond precision. */
function encodeBlockCursor(createdAt: string, blockedId: string): string {
  return Buffer.from(JSON.stringify([createdAt, blockedId])).toString('base64url');
}

function decodeBlockCursor(cursor: string): { createdAt: string; blockedId: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      !Number.isNaN(Date.parse(v[0])) &&
      typeof v[1] === 'string' &&
      UUID_RE.test(v[1])
    ) {
      return { createdAt: v[0], blockedId: v[1] };
    }
  } catch {
    // fall through
  }
  throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
    { path: 'cursor', message: 'invalid cursor' },
  ]);
}

const settingsColumns = {
  discoverableByPhone: users.discoverableByPhone,
  discoverableByEmail: users.discoverableByEmail,
  contactRequestsFrom: users.contactRequestsFrom,
  readReceipts: users.readReceipts,
};

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async getSettings(userId: string): Promise<PrivacySettings> {
    const [row] = await this.db.select(settingsColumns).from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw AppError.notFound('User not found');
    return row;
  }

  async updateSettings(userId: string, patch: UpdatePrivacyRequest, meta: RequestMeta): Promise<PrivacySettings> {
    const [row] = await this.db.update(users).set(patch).where(eq(users.id, userId)).returning(settingsColumns);
    if (!row) throw AppError.notFound('User not found');
    await this.audit.record({
      action: 'user.privacy_updated',
      actorUserId: userId,
      meta,
      metadata: { fields: Object.keys(patch) },
    });
    return row;
  }

  /**
   * Idempotent. The audit event's subject is the blocker: the blocked user is only named in
   * metadata so the block never shows up in their own security log.
   */
  async block(blockerId: string, blockedId: string, meta: RequestMeta): Promise<void> {
    await this.assertBlockableTarget(blockerId, blockedId);
    let inserted: { blockedId: string }[];
    try {
      inserted = await this.db
        .insert(userBlocks)
        .values({ blockerId, blockedId })
        .onConflictDoNothing()
        .returning({ blockedId: userBlocks.blockedId });
    } catch (err) {
      // The target was deleted between the check above and the insert (FK violation).
      const pgErr = ((err as { cause?: unknown }).cause ?? err) as { code?: string };
      if (pgErr.code === '23503') throw AppError.notFound('User not found');
      throw err;
    }
    // Blocking cuts the follow graph in both directions (also when the block already existed).
    await this.db
      .delete(follows)
      .where(
        or(
          and(eq(follows.followerId, blockerId), eq(follows.followeeId, blockedId)),
          and(eq(follows.followerId, blockedId), eq(follows.followeeId, blockerId)),
        ),
      );
    if (inserted.length === 0) return;
    await this.audit.record({ action: 'user.blocked', actorUserId: blockerId, meta, metadata: { blockedUserId: blockedId } });
  }

  /** Idempotent. An existing block can always be lifted, even if the other account is no longer active. */
  async unblock(blockerId: string, blockedId: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(blockedId)) throw AppError.notFound('User not found');
    const deleted = await this.db
      .delete(userBlocks)
      .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
      .returning({ blockedId: userBlocks.blockedId });
    if (deleted.length === 0) {
      await this.assertBlockableTarget(blockerId, blockedId);
      return;
    }
    await this.audit.record({
      action: 'user.unblocked',
      actorUserId: blockerId,
      meta,
      metadata: { blockedUserId: blockedId },
    });
  }

  /** Every block of the user, newest first (account export). API clients use `listBlocksPage`. */
  async listBlocks(userId: string): Promise<BlockedUser[]> {
    const rows = await this.db
      .select({
        userId: userBlocks.blockedId,
        handle: users.handle,
        displayName: users.displayName,
        createdAt: userBlocks.createdAt,
      })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedId))
      .where(eq(userBlocks.blockerId, userId))
      .orderBy(desc(userBlocks.createdAt), desc(userBlocks.blockedId));
    return rows.map((r) => ({
      userId: r.userId,
      handle: r.handle,
      displayName: r.displayName,
      blockedAt: r.createdAt.toISOString(),
    }));
  }

  /** Newest first. Keyset pagination on (created_at, blocked_id) so pages never overlap. */
  async listBlocksPage(userId: string, q: BlockListQuery): Promise<BlockList> {
    const filters = [eq(userBlocks.blockerId, userId)];
    if (q.cursor) {
      const c = decodeBlockCursor(q.cursor);
      filters.push(sql`(${userBlocks.createdAt}, ${userBlocks.blockedId}) < (${c.createdAt}::timestamptz, ${c.blockedId}::uuid)`);
    }
    const rows = await this.db
      .select({
        userId: userBlocks.blockedId,
        handle: users.handle,
        displayName: users.displayName,
        createdAt: userBlocks.createdAt,
        // Exact timestamp (microseconds) for the cursor; a JS Date would truncate to ms.
        createdAtExact: sql<string>`${userBlocks.createdAt}::text`,
      })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedId))
      .where(and(...filters))
      .orderBy(desc(userBlocks.createdAt), desc(userBlocks.blockedId))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        userId: r.userId,
        handle: r.handle,
        displayName: r.displayName,
        blockedAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit && last ? encodeBlockCursor(last.createdAtExact, last.userId) : null,
    };
  }

  /** True when either user blocked the other. Use it to hide profiles and refuse contact. */
  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const [row] = await this.db
      .select({ blockerId: userBlocks.blockerId })
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
          and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Malformed id or non-active user: 404 (indistinguishable). Blocking yourself: 400. */
  private async assertBlockableTarget(blockerId: string, blockedId: string): Promise<void> {
    if (!UUID_RE.test(blockedId)) throw AppError.notFound('User not found');
    if (blockedId.toLowerCase() === blockerId.toLowerCase()) {
      throw new AppError(400, ErrorCodes.validationFailed, 'You cannot block yourself', [
        { path: 'userId', message: 'cannot block yourself' },
      ]);
    }
    const [target] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, blockedId), eq(users.status, 'active')))
      .limit(1);
    if (!target) throw AppError.notFound('User not found');
  }
}
