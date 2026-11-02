import { Inject, Injectable } from '@nestjs/common';
import type { PlatformRole } from '@caselind/contracts';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { sessions, users } from '../db/schema.js';
import type { AuthUser } from './auth.guard.js';
import { TokenService } from './token.service.js';

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

  async verify(accessToken: string): Promise<AuthUser | null> {
    const claims = await this.tokens.verifyAccess(accessToken);
    if (!claims) return null;
    const [row] = await this.db
      .select({ status: users.status, roles: users.roles })
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
    if (!row || row.status !== 'active') return null;
    return { userId: claims.sub, sessionId: claims.sid, roles: row.roles as PlatformRole[] };
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
