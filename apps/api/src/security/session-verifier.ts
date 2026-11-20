import { Inject, Injectable } from '@nestjs/common';
import type { PlatformRole } from '@caselind/contracts';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { sessions, users } from '../db/schema.js';
import type { AuthUser } from './auth.guard.js';
import { TokenService } from './token.service.js';

/** A suspension or ban still in force for the session's user. */
export const SANCTION_IN_FORCE = sql`EXISTS (SELECT 1 FROM user_sanctions s WHERE s.user_id = ${users.id} AND s.kind IN ('suspension_temp', 'ban') AND s.status IN ('active', 'appealed') AND (s.ends_at IS NULL OR s.ends_at > now()))`;

/**
 * Single place deciding whether an access token still stands for a live session and an active
 * user. Used by the HTTP AuthGuard and by the Socket.IO handshake. Roles come from the database.
 */
@Injectable()
export class SessionVerifier {
  constructor(
    private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /**
   * `allowRestricted` (HTTP AuthGuard only): an account suspended or banned by a sanction in force keeps a restricted session,
   * so it can read and appeal its sanctions; the guard then refuses every route not marked `@AllowRestricted()`.
   */
  async verify(accessToken: string, opts: { allowRestricted?: boolean } = {}): Promise<AuthUser | null> {
    const claims = await this.tokens.verifyAccess(accessToken);
    if (!claims) return null;
    const [row] = await this.db
      .select({ status: users.status, roles: users.roles, sanctioned: sql<boolean>`${SANCTION_IN_FORCE}` })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, claims.sid),
          eq(sessions.userId, claims.sub),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) return null;
    const roles = row.roles as PlatformRole[];
    if (row.status === 'active') return { userId: claims.sub, sessionId: claims.sid, roles };
    if (opts.allowRestricted && row.status === 'suspended' && row.sanctioned) return { userId: claims.sub, sessionId: claims.sid, roles, restricted: true };
    return null;
  }

  /** Subset of the given session ids that are still live for an active user (periodic socket recheck). */
  async liveSessionIds(sessionIds: string[]): Promise<Set<string>> {
    if (sessionIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          inArray(sessions.id, sessionIds),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.status, 'active'),
        ),
      );
    return new Set(rows.map((r) => r.id));
  }
}
