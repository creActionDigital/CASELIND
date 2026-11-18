import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CreatePollRequest, Message, Poll } from '@caselind/contracts';
import { POLL_MAX_DAYS_AHEAD } from '@caselind/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { messagePollOptions, messagePolls, messagePollVotes } from '../db/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { insertUserMessage } from './message-insert.js';
import { MessagesService } from './messages.service.js';
import { bestEffort, loadMessage, requireActiveMember, validationError } from './messaging.shared.js';

/** Polls in a conversation. Voters are anonymous; question and options never reach logs or audit. */
@Injectable()
export class PollsService {
  private readonly logger = new Logger(PollsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly messages: MessagesService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Idempotent per (conversation, sender, clientId), like any message (created=false on a replay). */
  async create(userId: string, conversationId: string, req: CreatePollRequest, meta: RequestMeta): Promise<{ message: Message; created: boolean }> {
    const { conversation } = await requireActiveMember(this.db, conversationId, userId);
    if (conversation.kind === 'direct') await this.messages.assertDirectOpen(userId, conversationId);
    const labels = req.options;
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw validationError('options', 'options must be different');
    let closesAt: Date | null = null;
    if (req.closesAt) {
      closesAt = new Date(req.closesAt);
      const ahead = closesAt.getTime() - Date.now();
      if (ahead < 60_000 || ahead > POLL_MAX_DAYS_AHEAD * 86_400_000) {
        throw validationError('closesAt', `must be between 1 minute and ${POLL_MAX_DAYS_AHEAD} days ahead`);
      }
    }
    const out = await this.db.transaction(async (tx) => {
      const r = await insertUserMessage(tx, userId, conversationId, {
        kind: 'poll',
        clientId: req.clientId,
        body: req.question,
        mediaId: null,
        replyToId: null,
        mentions: [],
      });
      if (r.created) {
        await tx.insert(messagePolls).values({ messageId: r.row.id, creatorId: userId, question: req.question, multiple: req.multiple, closesAt });
        await tx.insert(messagePollOptions).values(labels.map((label, position) => ({ messageId: r.row.id, position, label })));
        await this.audit.record(
          { action: 'message.poll_created', actorUserId: userId, meta, metadata: { conversationId, messageId: r.row.id } },
          tx,
        );
      }
      return r;
    });
    const message = await loadMessage(this.db, out.row, userId);
    if (out.created) await this.messages.afterSend(userId, conversation, out.row, message);
    return { message, created: out.created };
  }

  /** Replaces the caller's votes (an empty list withdraws them) while the poll is open. */
  async vote(userId: string, messageId: string, optionIds: string[]): Promise<Message> {
    const found = await this.messages.visibleMessage(this.db, userId, messageId);
    if (!found || found.message.kind !== 'poll') throw AppError.notFound('Message not found');
    const m = found.message;
    if (m.recalledAt) throw AppError.conflict('This message was recalled', { reason: 'recalled' });
    if (m.senderId && m.senderId !== userId) {
      const blocked = await this.db.execute(sql`
        SELECT 1 FROM user_blocks
        WHERE (blocker_id = ${userId} AND blocked_id = ${m.senderId}) OR (blocker_id = ${m.senderId} AND blocked_id = ${userId})
        LIMIT 1`);
      if (blocked.rows.length > 0) throw AppError.notFound('Message not found');
    }
    const wanted = [...new Set(optionIds.map((o) => o.toLowerCase()))];
    await this.db.transaction(async (tx) => {
      const [poll] = await tx.select().from(messagePolls).where(eq(messagePolls.messageId, m.id)).for('update');
      if (!poll) throw AppError.notFound('Message not found');
      if (isClosed(poll)) throw AppError.conflict('This poll is closed', { reason: 'poll_closed' });
      const options = await tx.select({ id: messagePollOptions.id }).from(messagePollOptions).where(eq(messagePollOptions.messageId, m.id));
      const valid = new Set(options.map((o) => o.id));
      if (!wanted.every((id) => valid.has(id))) throw validationError('optionIds', 'every option must belong to this poll');
      if (!poll.multiple && wanted.length > 1) throw validationError('optionIds', 'this poll accepts a single choice');
      await tx.delete(messagePollVotes).where(and(eq(messagePollVotes.messageId, m.id), eq(messagePollVotes.userId, userId)));
      if (wanted.length > 0) {
        await tx.insert(messagePollVotes).values(wanted.map((optionId) => ({ optionId, messageId: m.id, userId })));
      }
    });
    const message = await loadMessage(this.db, m, userId);
    this.emit(m.conversationId, m.id, message.poll);
    return message;
  }

  /** The creator, or an admin/owner of the group. Idempotent. */
  async close(userId: string, messageId: string, meta: RequestMeta): Promise<Message> {
    const found = await this.messages.visibleMessage(this.db, userId, messageId);
    if (!found || found.message.kind !== 'poll') throw AppError.notFound('Message not found');
    const m = found.message;
    if (m.recalledAt) throw AppError.conflict('This message was recalled', { reason: 'recalled' });
    const isAdmin = found.member.role === 'owner' || found.member.role === 'admin';
    if (m.senderId !== userId && !isAdmin) throw AppError.forbidden('Only the creator or a group admin can close a poll');
    const closed = await this.db.transaction(async (tx) => {
      const res = await tx
        .update(messagePolls)
        .set({ closedAt: sql`now()` })
        .where(and(eq(messagePolls.messageId, m.id), sql`${messagePolls.closedAt} IS NULL`))
        .returning({ id: messagePolls.messageId });
      if (res.length === 0) return false;
      await this.audit.record(
        { action: 'message.poll_closed', actorUserId: userId, meta, metadata: { conversationId: m.conversationId, messageId: m.id } },
        tx,
      );
      return true;
    });
    const message = await loadMessage(this.db, m, userId);
    if (closed) this.emit(m.conversationId, m.id, message.poll);
    return message;
  }

  private emit(conversationId: string, messageId: string, poll: Poll | null): void {
    if (!poll) return;
    void bestEffort(this.logger, 'poll event', () =>
      this.realtime.emitToConversation(conversationId, 'message.poll', { conversationId, messageId, poll: { ...poll, myVotes: [] } }),
    );
  }
}

function isClosed(p: { closedAt: Date | null; closesAt: Date | null }): boolean {
  return p.closedAt !== null || (p.closesAt !== null && p.closesAt.getTime() <= Date.now());
}
