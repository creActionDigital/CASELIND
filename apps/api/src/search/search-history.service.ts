import { Inject, Injectable } from '@nestjs/common';
import type { SearchHistory, SearchHistorySettings, SearchScope } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';

export const MAX_HISTORY = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Search history. Private to its owner: no route reads another user's entries, nothing is ever
 * shared or used for ranking. At most 50 entries (oldest dropped), one per (query, scope).
 */
@Injectable()
export class SearchHistoryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async isEnabled(userId: string): Promise<boolean> {
    const res = await this.db.execute(sql`SELECT history_enabled FROM search_settings WHERE user_id = ${userId}::uuid`);
    const row = res.rows[0] as { history_enabled: boolean } | undefined;
    return row?.history_enabled ?? true;
  }

  async list(userId: string): Promise<SearchHistory> {
    const res = await this.db.execute(sql`
      SELECT id, query, scope, created_at FROM search_history
      WHERE user_id = ${userId}::uuid ORDER BY created_at DESC, id DESC LIMIT ${MAX_HISTORY}`);
    return {
      enabled: await this.isEnabled(userId),
      items: (res.rows as { id: string; query: string; scope: SearchScope; created_at: string | Date }[]).map((r) => ({
        id: r.id,
        query: r.query,
        scope: r.scope,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  }

  /** Remembers a search (no-op when the user switched the history off). Never fails the search. */
  async record(userId: string, query: string, scope: SearchScope): Promise<void> {
    try {
      if (!(await this.isEnabled(userId))) return;
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM search_history WHERE user_id = ${userId}::uuid AND scope = ${scope} AND lower(query) = lower(${query})`);
        await tx.execute(sql`INSERT INTO search_history (user_id, query, scope) VALUES (${userId}::uuid, ${query}, ${scope})`);
        await tx.execute(sql`
          DELETE FROM search_history WHERE user_id = ${userId}::uuid AND id NOT IN (
            SELECT id FROM search_history WHERE user_id = ${userId}::uuid ORDER BY created_at DESC, id DESC LIMIT ${MAX_HISTORY})`);
      });
    } catch {
      // The history is a convenience: a failure must not break the search itself.
    }
  }

  async clear(userId: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM search_history WHERE user_id = ${userId}::uuid`);
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Entry not found');
    const res = await this.db.execute(sql`DELETE FROM search_history WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
    if ((res.rowCount ?? 0) === 0) throw AppError.notFound('Entry not found');
  }

  async setEnabled(userId: string, enabled: boolean): Promise<SearchHistorySettings> {
    await this.db.execute(sql`
      INSERT INTO search_settings (user_id, history_enabled) VALUES (${userId}::uuid, ${enabled})
      ON CONFLICT (user_id) DO UPDATE SET history_enabled = EXCLUDED.history_enabled, updated_at = now()`);
    return { enabled };
  }
}
