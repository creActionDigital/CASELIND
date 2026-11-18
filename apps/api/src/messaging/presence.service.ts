import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Presence } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { RealtimeService } from '../realtime/realtime.service.js';

// Local copy: importing messaging.shared here would close an import cycle (privacy.service uses this service).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hidden = (userId: string): Presence => ({ userId, visible: false, online: false, lastSeenAt: null });

/**
 * "Online" / "last seen". Online = a connected socket (Socket.IO rooms); the only thing stored is
 * users.last_seen_at. Seen only between two users with an ACTIVE direct conversation, not blocked either
 * way, who both show their presence (reciprocity). Anything else looks the same: not visible.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  async get(viewerId: string, subjectId: string): Promise<Presence> {
    if (!UUID_RE.test(subjectId)) throw AppError.notFound('User not found');
    subjectId = subjectId.toLowerCase();
    if (subjectId === viewerId.toLowerCase()) return hidden(subjectId);
    const res = await this.db.execute<{ last_seen_at: Date | null }>(sql`
      SELECT s.last_seen_at
      FROM users s, users v
      WHERE s.id = ${subjectId} AND v.id = ${viewerId} AND s.status = 'active' AND s.show_presence AND v.show_presence
        AND EXISTS (
          SELECT 1 FROM conversation_members a
          JOIN conversation_members b ON b.conversation_id = a.conversation_id AND b.user_id = s.id AND b.status = 'active'
          JOIN conversations c ON c.id = a.conversation_id AND c.kind = 'direct'
          WHERE a.user_id = v.id AND a.status = 'active')
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks k
          WHERE (k.blocker_id = v.id AND k.blocked_id = s.id) OR (k.blocker_id = s.id AND k.blocked_id = v.id))`);
    const row = res.rows[0];
    if (!row) return hidden(subjectId);
    return { userId: subjectId, visible: true, online: await this.realtime.isOnline(subjectId), lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null };
  }

  /** A socket connected or closed: last_seen_at is now, and peers learn the new state (offline only once no device is left). */
  async touch(userId: string): Promise<void> {
    try {
      await this.db.execute(sql`UPDATE users SET last_seen_at = now() WHERE id = ${userId}`);
      await this.broadcast(userId);
    } catch (err) {
      this.logger.warn(`presence update failed: ${(err as Error).name}`);
    }
  }

  /** Pushes the user's presence to each peer allowed to see it (also called when the user changes the setting). */
  async broadcast(userId: string): Promise<void> {
    const subject = await this.db.execute<{ show_presence: boolean; last_seen_at: Date | null }>(sql`
      SELECT show_presence, last_seen_at FROM users WHERE id = ${userId} AND status = 'active'`);
    const s = subject.rows[0];
    if (!s) return;
    const peers = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT b.user_id
      FROM conversation_members a
      JOIN conversations c ON c.id = a.conversation_id AND c.kind = 'direct'
      JOIN conversation_members b ON b.conversation_id = a.conversation_id AND b.user_id <> a.user_id AND b.status = 'active'
      JOIN users p ON p.id = b.user_id AND p.status = 'active' AND p.show_presence
      WHERE a.user_id = ${userId} AND a.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks k
          WHERE (k.blocker_id = a.user_id AND k.blocked_id = b.user_id) OR (k.blocker_id = b.user_id AND k.blocked_id = a.user_id))`);
    if (peers.rows.length === 0) return;
    const payload: Presence = s.show_presence
      ? { userId, visible: true, online: await this.realtime.isOnline(userId), lastSeenAt: s.last_seen_at ? new Date(s.last_seen_at).toISOString() : null }
      : hidden(userId);
    for (const p of peers.rows) this.realtime.emitToUser(p.user_id, 'presence.updated', payload);
  }
}
