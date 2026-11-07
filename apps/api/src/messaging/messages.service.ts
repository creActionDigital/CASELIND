import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Message, MessageList, MessageListQuery, SendMessageRequest } from '@caselind/contracts';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import {
  type ConversationMemberRow,
  conversationMembers,
  type ConversationRow,
  mediaAssets,
  messageHidden,
  messageReactions,
  messages,
  type MessageRow,
  users,
} from '../db/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { insertUserMessage } from './message-insert.js';
import {
  bestEffort,
  type Exec,
  loadMessage,
  loadMessages,
  requireActiveMember,
  UUID_RE,
  validationError,
} from './messaging.shared.js';

/** The generic push body: message content is never sent to a third party (CDC §6). */
export const PUSH_BODY = 'Nouveau message';

/** Sending, reading, reacting to and recalling messages. Message content never reaches logs or audit. */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly privacy: PrivacyService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ sending */

  /** Idempotent per (conversation, sender, clientId): a retry returns the stored message (created=false). */
  async send(userId: string, conversationId: string, req: SendMessageRequest): Promise<{ message: Message; created: boolean }> {
    const { conversation } = await requireActiveMember(this.db, conversationId, userId);
    if (conversation.kind === 'direct') await this.assertDirectOpen(userId, conversationId);

    const mentions = [...new Set((req.mentions ?? []).map((m) => m.toLowerCase()))];
    await this.assertMentionsAreMembers(conversationId, mentions);
    if (req.mediaId) await this.assertSendableMedia(userId, req.mediaId);
    if (req.replyToId) await this.assertReplyTarget(userId, conversationId, req.replyToId);

    const out = await this.db.transaction((tx) =>
      insertUserMessage(tx, userId, conversationId, {
        kind: req.kind,
        clientId: req.clientId,
        body: req.kind === 'text' ? req.body!.trim() : req.body?.trim() || null,
        mediaId: req.kind === 'media' ? req.mediaId! : null,
        replyToId: req.replyToId ?? null,
        mentions,
        clearDraft: true,
      }),
    );
    if (out.created) await this.clearDraftEvent(userId, conversationId);

    const message = await loadMessage(this.db, out.row, userId);
    if (out.created) await this.afterSend(userId, conversation, out.row, message);
    return { message, created: out.created };
  }

  /** A draft consumed by a send disappears on the user's other devices too. */
  private async clearDraftEvent(userId: string, conversationId: string): Promise<void> {
    await bestEffort(this.logger, 'draft event', () => this.realtime.emitToUser(userId, 'draft.updated', { conversationId, body: null }));
  }

  /** Real-time event and push, after the commit; neither can make the request fail. */
  async afterSend(senderId: string, conversation: ConversationRow, row: MessageRow, message: Message): Promise<void> {
    try {
      this.realtime.emitToConversation(conversation.id, 'message.new', { ...message, myReaction: null, favorited: false });
      const recipients = await this.db.execute<{ user_id: string; muted: boolean }>(sql`
        SELECT cm.user_id, (cm.muted_until IS NOT NULL AND cm.muted_until > now()) AS muted
        FROM conversation_members cm
        JOIN users u ON u.id = cm.user_id AND u.status = 'active'
        WHERE cm.conversation_id = ${conversation.id} AND cm.status = 'active' AND cm.user_id <> ${senderId}
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = cm.user_id AND b.blocked_id = ${senderId})`);
      const mentioned = new Set(row.mentions);
      const inputs = recipients.rows
        .filter((r) => !r.muted || mentioned.has(r.user_id))
        .map((r) => ({ userId: r.user_id, urgent: mentioned.has(r.user_id) }));
      if (inputs.length === 0) return;
      let title = conversation.title ?? '';
      if (conversation.kind === 'direct') {
        const [sender] = await this.db.select({ displayName: users.displayName }).from(users).where(eq(users.id, senderId)).limit(1);
        title = sender?.displayName ?? 'CASELIND';
      }
      void Promise.resolve(
        this.notifications.notifyMany(
          inputs.map((i) => ({
            userId: i.userId,
            category: 'message' as const,
            title,
            body: PUSH_BODY,
            data: { conversationId: conversation.id, messageId: row.id },
            persist: false,
            ...(i.urgent && { urgent: true }),
          })),
        ),
      ).catch((err: unknown) => this.logger.warn(`message push failed: ${(err as Error).name}`));
    } catch (err) {
      this.logger.warn(`message post-commit effects failed: ${(err as Error).name}`);
    }
  }

  async assertDirectOpen(userId: string, conversationId: string): Promise<void> {
    const [peer] = await this.db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.status, 'active'),
          sql`${conversationMembers.userId} <> ${userId}`,
        ),
      )
      .limit(1);
    if (!peer) throw AppError.forbidden('The other participant is no longer available');
    if (await this.privacy.isBlockedEitherWay(userId, peer.userId)) throw AppError.forbidden('You cannot message this user');
  }

  async assertMentionsAreMembers(conversationId: string, mentions: string[]): Promise<void> {
    if (mentions.length === 0) return;
    const rows = await this.db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.status, 'active'),
          inArray(conversationMembers.userId, mentions),
        ),
      );
    if (rows.length !== mentions.length) throw validationError('mentions', 'every mention must be a member of the conversation');
  }

  async assertSendableMedia(userId: string, mediaId: string): Promise<void> {
    const [asset] = await this.db
      .select({ ownerUserId: mediaAssets.ownerUserId, purpose: mediaAssets.purpose, status: mediaAssets.status })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, mediaId))
      .limit(1);
    if (!asset || asset.ownerUserId !== userId || asset.purpose !== 'message' || asset.status !== 'ready') {
      throw validationError('mediaId', 'must be one of your ready uploads with purpose "message"');
    }
  }

  async assertReplyTarget(userId: string, conversationId: string, replyToId: string): Promise<void> {
    const found = await this.visibleMessage(this.db, userId, replyToId);
    if (!found || found.message.conversationId !== conversationId) {
      throw validationError('replyToId', 'must be a message of this conversation');
    }
  }

  /* ------------------------------------------------------------------ reading */

  /** Most recent first. A member only sees messages from their entry; messages hidden "for me" are skipped. */
  async list(userId: string, conversationId: string, q: MessageListQuery): Promise<MessageList> {
    const { member } = await requireActiveMember(this.db, conversationId, userId);
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          sql`${messages.seq} >= ${member.firstSeq}`,
          q.beforeSeq !== undefined ? lt(messages.seq, q.beforeSeq) : undefined,
          sql`NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = ${messages.id} AND h.user_id = ${userId})`,
          sql`(${messages.expiresAt} IS NULL OR ${messages.expiresAt} > now())`,
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(q.limit + 1);
    return { items: await loadMessages(this.db, rows.slice(0, q.limit), userId), hasMore: rows.length > q.limit };
  }

  /** The message if the user is an active member who may see it (404 semantics otherwise). */
  async visibleMessage(
    exec: Exec,
    userId: string,
    messageId: string,
  ): Promise<{ message: MessageRow; member: ConversationMemberRow } | undefined> {
    if (!UUID_RE.test(messageId)) return undefined;
    const [row] = await exec
      .select({ message: messages, member: conversationMembers })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.userId, userId),
          eq(conversationMembers.status, 'active'),
        ),
      )
      .where(
        and(
          eq(messages.id, messageId),
          sql`${messages.seq} >= ${conversationMembers.firstSeq}`,
          sql`NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = ${messages.id} AND h.user_id = ${userId})`,
          sql`(${messages.expiresAt} IS NULL OR ${messages.expiresAt} > now())`,
        ),
      )
      .limit(1);
    return row;
  }

  /* ------------------------------------------------------------------ reactions */

  /** One reaction per user; null removes it. */
  async react(userId: string, messageId: string, emoji: string | null): Promise<Message> {
    const found = await this.visibleMessage(this.db, userId, messageId);
    if (!found) throw AppError.notFound('Message not found');
    const m = found.message;
    if (m.kind === 'system') throw validationError('messageId', 'system messages cannot receive reactions');
    if (m.recalledAt) throw AppError.conflict('This message was recalled', { reason: 'recalled' });
    if (emoji === null) {
      await this.db.delete(messageReactions).where(and(eq(messageReactions.messageId, m.id), eq(messageReactions.userId, userId)));
    } else {
      await this.db
        .insert(messageReactions)
        .values({ messageId: m.id, userId, emoji })
        .onConflictDoUpdate({ target: [messageReactions.messageId, messageReactions.userId], set: { emoji, createdAt: sql`now()` } });
    }
    const message = await loadMessage(this.db, m, userId);
    this.realtime.emitToConversation(m.conversationId, 'message.reaction', {
      conversationId: m.conversationId,
      messageId: m.id,
      userId,
      emoji,
      reactions: message.reactions,
    });
    return message;
  }

  /* ------------------------------------------------------------------ recall */

  /**
   * scope=me hides the message from the caller's own view. scope=all (author only, within
   * MESSAGE_RECALL_WINDOW_SECONDS) wipes body and media for everyone; the message stays as a tombstone.
   */
  async remove(userId: string, messageId: string, scope: 'me' | 'all', meta: RequestMeta): Promise<void> {
    const found = await this.visibleMessage(this.db, userId, messageId);
    if (!found) throw AppError.notFound('Message not found');
    const m = found.message;
    if (scope === 'me') {
      await this.db.insert(messageHidden).values({ messageId: m.id, userId }).onConflictDoNothing();
      return;
    }
    if (m.senderId !== userId || m.kind === 'system') throw AppError.forbidden('Only the author can recall a message');
    if (m.recalledAt) return;
    const windowMs = this.env.MESSAGE_RECALL_WINDOW_SECONDS * 1000;
    if (Date.now() - m.createdAt.getTime() > windowMs) {
      throw AppError.conflict('The recall window has elapsed', {
        reason: 'recall_window_elapsed',
        windowSeconds: this.env.MESSAGE_RECALL_WINDOW_SECONDS,
      });
    }
    const recalled = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(messages)
        .set({ recalledAt: sql`now()`, body: null, mediaId: null, mentions: [] })
        .where(and(eq(messages.id, m.id), isNull(messages.recalledAt)))
        .returning();
      if (!row) return undefined;
      await tx.delete(messageReactions).where(eq(messageReactions.messageId, m.id));
      await this.audit.record(
        { action: 'message.recalled', actorUserId: userId, meta, metadata: { conversationId: m.conversationId, messageId: m.id } },
        tx,
      );
      return row;
    });
    if (recalled) {
      await bestEffort(this.logger, 'recall event', async () =>
        this.realtime.emitToConversation(m.conversationId, 'message.updated', await loadMessage(this.db, recalled, null)),
      );
    }
  }
}
