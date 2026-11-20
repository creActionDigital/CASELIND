import { Inject, Injectable } from '@nestjs/common';
import { ErrorCodes } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { PublishRateLimiter } from './anti-spam.logic.js';

export type PublishKind = 'post' | 'comment' | 'story';

/**
 * Avant toute publication (publication, commentaire, story) : un compte au blocage de publication en vigueur est refusé (403,
 * `details.reason = muted`), et un utilisateur qui dépasse sa limite horaire reçoit 429 avec `Retry-After` (anti-spam, CDC §26).
 */
@Injectable()
export class PublishGuard {
  private readonly limiter = new PublishRateLimiter();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async assertMayPublish(userId: string, kind: PublishKind): Promise<void> {
    const r = await this.db.execute<{ until: Date }>(sql`
      SELECT max(ends_at) AS until FROM user_sanctions
      WHERE user_id = ${userId}::uuid AND kind = 'mute_posting' AND status IN ('active', 'appealed') AND ends_at > now()`);
    const until = r.rows[0]?.until;
    if (until) throw new AppError(403, ErrorCodes.forbidden, 'Publishing is suspended on your account', { reason: 'muted', until: new Date(until).toISOString() });
    if (kind === 'story') return;
    const limit = kind === 'post' ? this.env.ANTISPAM_POSTS_PER_HOUR : this.env.ANTISPAM_COMMENTS_PER_HOUR;
    const v = this.limiter.hit(`${userId}:${kind}`, limit);
    if (!v.ok) throw new AppError(429, ErrorCodes.rateLimited, 'Too many publications, please retry later', { reason: 'publish_rate', retryAfterSeconds: v.retryAfterSeconds });
  }
}
