import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  SCHEDULE_MAX_SECONDS,
  SCHEDULE_MIN_SECONDS,
  type ScheduledMessage,
  type ScheduledMessageList,
  type SendMessageRequest,
} from '@caselind/contracts';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type pg from 'pg';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db, PG_POOL } from '../db/db.module.js';
import {
  conversationDrafts,
  conversationMembers,
  conversations,
  messages,
  type ScheduledMessageRow,
  scheduledMessages,
  users,
} from '../db/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { insertUserMessage } from './message-insert.js';
import { MessagesService } from './messages.service.js';
import { activeMemberRow, bestEffort, loadMessage, requireActiveMember, UUID_RE, validationError } from './messaging.shared.js';

/** Session-level advisory lock key of the scheduler (migrator 727372, maintenance 727373). */
export const SCHEDULER_LOCK_KEY = 727374;
export const SCHEDULER_INTERVAL_MS = 60_000;
/** Pending scheduled messages per user. */
export const SCHEDULED_PENDING_MAX = 100;
const BATCH = 200;

export interface SchedulerResult {
  sent: number;
  cancelled: number;
}

function toDto(row: ScheduledMessageRow): ScheduledMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    clientId: row.clientId,
    kind: row.kind,
    body: row.body,
    mediaId: row.mediaId,
    replyToId: row.replyToId,
    mentions: row.mentions,
    scheduledAt: row.scheduledAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Deferred messages. A scheduled message has no seq and is served nowhere until the minute job turns it
 * into a regular message; the send rules are evaluated again at that moment. Content never reaches
 * logs or audit.
 *
 * The timer is started only when MESSAGING_SCHEDULER_ENABLED is true; `runOnce` stays callable directly.
 */
@Injectable()
export class ScheduledMessagesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ScheduledMessagesService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(ENV) private readonly env: Env,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.MESSAGING_SCHEDULER_ENABLED) return;
    this.timer = setInterval(() => void this.scheduledRun(), SCHEDULER_INTERVAL_MS).unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async scheduledRun(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error(`scheduler run failed: ${(err as Error).name}`);
    }
  }

  /* ------------------------------------------------------------------ API */

  /** Same checks as an immediate send, then the message waits. Idempotent per (conversation, sender, clientId). */
  async schedule(
    userId: string,
    conversationId: string,
    req: SendMessageRequest,
    now: Date = new Date(),
  ): Promise<{ scheduled: ScheduledMessage; created: boolean }> {
    const when = new Date(req.scheduledAt!);
    const delta = (when.getTime() - now.getTime()) / 1000;
    if (delta < SCHEDULE_MIN_SECONDS || delta > SCHEDULE_MAX_SECONDS) {
      throw validationError('scheduledAt', 'must be between 1 minute and 30 days from now');
    }
    const { conversation } = await requireActiveMember(this.db, conversationId, userId);
    if (conversation.kind === 'direct') await this.messages.assertDirectOpen(userId, conversationId);
    const mentions = [...new Set((req.mentions ?? []).map((m) => m.toLowerCase()))];
    await this.messages.assertMentionsAreMembers(conversationId, mentions);
    if (req.mediaId) await this.messages.assertSendableMedia(userId, req.mediaId);
    if (req.replyToId) await this.messages.assertReplyTarget(userId, conversationId, req.replyToId);

    const [existing] = await this.db
      .select()
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.senderId, userId),
          eq(scheduledMessages.conversationId, conversationId),
          eq(scheduledMessages.clientId, req.clientId),
        ),
      )
      .limit(1);
    if (existing) return { scheduled: toDto(existing), created: false };
    const [sent] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.senderId, userId), eq(messages.conversationId, conversationId), eq(messages.clientId, req.clientId)))
      .limit(1);
    if (sent) throw AppError.conflict('This clientId was already used', { reason: 'client_id_used' });

    const pending = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM scheduled_messages WHERE sender_id = ${userId}`);
    if ((pending.rows[0]?.n ?? 0) >= SCHEDULED_PENDING_MAX) {
      throw AppError.conflict('Too many scheduled messages', { reason: 'scheduled_limit', max: SCHEDULED_PENDING_MAX });
    }
    const [row] = await this.db
      .insert(scheduledMessages)
      .values({
        conversationId,
        senderId: userId,
        clientId: req.clientId,
        kind: req.kind,
        body: req.kind === 'text' ? req.body!.trim() : req.body?.trim() || null,
        mediaId: req.kind === 'media' ? req.mediaId! : null,
        replyToId: req.replyToId ?? null,
        mentions,
        scheduledAt: when,
      })
      .returning();
    // The composer is cleared: the draft goes, here and on the other devices.
    const cleared = await this.db
      .delete(conversationDrafts)
      .where(and(eq(conversationDrafts.conversationId, conversationId), eq(conversationDrafts.userId, userId)));
    if ((cleared.rowCount ?? 0) > 0) {
      await bestEffort(this.logger, 'draft event', () =>
        this.realtime.emitToUser(userId, 'draft.updated', { conversationId, body: null }),
      );
    }
    return { scheduled: toDto(row!), created: true };
  }

  async list(userId: string): Promise<ScheduledMessageList> {
    const rows = await this.db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.senderId, userId))
      .orderBy(asc(scheduledMessages.scheduledAt), asc(scheduledMessages.id))
      .limit(SCHEDULED_PENDING_MAX);
    return { items: rows.map(toDto) };
  }

  async cancel(userId: string, id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Scheduled message not found');
    const res = await this.db
      .delete(scheduledMessages)
      .where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.senderId, userId)))
      .returning({ id: scheduledMessages.id });
    if (res.length === 0) throw AppError.notFound('Scheduled message not found');
  }

  /* ------------------------------------------------------------------ job */

  /**
   * Sends every message whose time has come. Idempotent: a row is deleted in the same transaction that
   * creates its message, and rows are taken with SKIP LOCKED. Returns zeros when another instance holds
   * the advisory lock.
   */
  async runOnce(now: Date = new Date()): Promise<SchedulerResult> {
    const lockClient = await this.pool.connect();
    let unlockFailed = false;
    try {
      const { rows } = await lockClient.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [SCHEDULER_LOCK_KEY]);
      if (!rows[0]?.locked) return { sent: 0, cancelled: 0 };
      try {
        const result: SchedulerResult = { sent: 0, cancelled: 0 };
        const due = await this.db
          .select()
          .from(scheduledMessages)
          .where(lte(scheduledMessages.scheduledAt, now))
          .orderBy(asc(scheduledMessages.scheduledAt), asc(scheduledMessages.id))
          .limit(BATCH);
        for (const row of due) {
          try {
            const outcome = await this.process(row);
            if (outcome === 'sent') result.sent += 1;
            else if (outcome === 'cancelled') result.cancelled += 1;
          } catch (err) {
            // Left in place: the next run retries it.
            this.logger.warn(`scheduled message not processed: ${(err as Error).name}`);
          }
        }
        if (result.sent + result.cancelled > 0) this.logger.log(`scheduler: sent=${result.sent} cancelled=${result.cancelled}`);
        return result;
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_KEY]).catch(() => {
          unlockFailed = true;
        });
      }
    } finally {
      lockClient.release(unlockFailed);
    }
  }

  /** The send rules, evaluated at delivery time; returns a reason code when the message must be cancelled. */
  private async refusal(row: ScheduledMessageRow): Promise<string | null> {
    const member = await activeMemberRow(this.db, row.conversationId, row.senderId);
    if (!member) return 'not_member';
    const [sender] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, row.senderId)).limit(1);
    if (sender?.status !== 'active') return 'sender_inactive';
    const [conv] = await this.db.select({ kind: conversations.kind }).from(conversations).where(eq(conversations.id, row.conversationId)).limit(1);
    if (!conv) return 'not_member';
    if (conv.kind === 'direct') {
      try {
        await this.messages.assertDirectOpen(row.senderId, row.conversationId);
      } catch {
        return 'not_allowed';
      }
    }
    if (row.mediaId) {
      try {
        await this.messages.assertSendableMedia(row.senderId, row.mediaId);
      } catch {
        return 'media_unavailable';
      }
    }
    return null;
  }

  private async process(row: ScheduledMessageRow): Promise<'sent' | 'cancelled' | 'skipped'> {
    const reason = await this.refusal(row);
    if (reason) return (await this.cancelDue(row, reason)) ? 'cancelled' : 'skipped';

    // Quoted message or mentioned members that vanished do not block the send.
    const replyOk = row.replyToId ? await this.messages.visibleMessage(this.db, row.senderId, row.replyToId) : undefined;
    const mentions = row.mentions.length === 0 ? [] : await this.stillMembers(row.conversationId, row.mentions);

    let out: Awaited<ReturnType<typeof insertUserMessage>> | null;
    try {
      out = await this.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(scheduledMessages)
          .where(eq(scheduledMessages.id, row.id))
          .for('update', { skipLocked: true });
        if (!locked) return null;
        const inserted = await insertUserMessage(tx, row.senderId, row.conversationId, {
          kind: locked.kind,
          clientId: locked.clientId,
          body: locked.body,
          mediaId: locked.mediaId,
          replyToId: replyOk && replyOk.message.conversationId === row.conversationId ? row.replyToId : null,
          mentions,
        });
        await tx.delete(scheduledMessages).where(eq(scheduledMessages.id, row.id));
        return inserted;
      });
    } catch (err) {
      if (err instanceof AppError && err.status === 404) return (await this.cancelDue(row, 'not_member')) ? 'cancelled' : 'skipped';
      throw err;
    }
    if (!out) return 'skipped';
    if (out.created) {
      const { conversation } = await requireActiveMember(this.db, row.conversationId, row.senderId).catch(() => ({ conversation: null }));
      await bestEffort(this.logger, 'scheduled send effects', async () => {
        if (!conversation) return;
        await this.messages.afterSend(row.senderId, conversation, out.row, await loadMessage(this.db, out.row, row.senderId));
      });
    }
    return 'sent';
  }

  private async stillMembers(conversationId: string, ids: string[]): Promise<string[]> {
    const rows = await this.db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.status, 'active'),
          inArray(conversationMembers.userId, ids),
        ),
      );
    return rows.map((r) => r.userId);
  }

  /** Drops a message that can no longer be sent and tells its author (generic text, no content). */
  private async cancelDue(row: ScheduledMessageRow, reason: string): Promise<boolean> {
    const res = await this.db.delete(scheduledMessages).where(eq(scheduledMessages.id, row.id)).returning({ id: scheduledMessages.id });
    if (res.length === 0) return false;
    this.logger.log(`scheduled message cancelled: reason=${reason}`);
    await bestEffort(this.logger, 'scheduled cancel notification', () =>
      this.notifications.notify({
        userId: row.senderId,
        category: 'message',
        title: 'Message programmé non envoyé',
        body: "Votre message programmé n'a pas pu être envoyé.",
        data: { conversationId: row.conversationId, reason },
      }),
    );
    return true;
  }
}
