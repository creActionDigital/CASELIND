import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { messageReactions, messages } from '../db/schema.js';
import { bestEffort, loadMessage, UUID_RE } from '../messaging/messaging.shared.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ModerationRegistry } from './moderation-registry.js';

/**
 * Registers `message` as a moderatable target. A message can be reported by an active member who
 * can see it; hiding it is a server-side recall (body and media wiped, tombstone kept), which
 * cannot be undone: `restore` is a no-op for messages. Content never reaches logs.
 */
@Injectable()
export class MessageModerationTarget implements OnModuleInit {
  private readonly logger = new Logger(MessageModerationTarget.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ModerationRegistry,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit(): void {
    this.registry.register('message', {
      visibleTo: async (viewerId, targetId) => {
        if (!UUID_RE.test(targetId)) return false;
        const res = await this.db.execute(sql`
          SELECT 1 FROM messages m
          JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${viewerId} AND cm.status = 'active'
          WHERE m.id = ${targetId} AND m.recalled_at IS NULL AND m.kind <> 'system' AND m.seq >= cm.first_seq
            AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ${viewerId})
          LIMIT 1`);
        return res.rows.length > 0;
      },
      authorOf: async (targetId) => {
        if (!UUID_RE.test(targetId)) return null;
        const [row] = await this.db.select({ senderId: messages.senderId }).from(messages).where(eq(messages.id, targetId)).limit(1);
        return row?.senderId ?? null;
      },
      setHidden: async (targetId, hidden) => {
        if (!hidden || !UUID_RE.test(targetId)) return;
        const [row] = await this.db
          .update(messages)
          .set({ recalledAt: sql`now()`, body: null, mediaId: null, mentions: [] })
          .where(and(eq(messages.id, targetId), isNull(messages.recalledAt)))
          .returning();
        if (!row) return;
        await this.db.delete(messageReactions).where(eq(messageReactions.messageId, targetId));
        await bestEffort(this.logger, 'moderation recall event', async () =>
          this.realtime.emitToConversation(row.conversationId, 'message.updated', await loadMessage(this.db, row, null)),
        );
      },
    });
  }
}
