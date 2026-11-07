import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Draft,
  FavoriteList,
  FavoriteListQuery,
  ForwardMessageRequest,
  ForwardMessageResponse,
  ForwardResult,
} from '@caselind/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { conversationDrafts, mediaAssets, messageFavorites, type MessageRow, messages } from '../db/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { insertUserMessage } from './message-insert.js';
import { MessagesService } from './messages.service.js';
import {
  bestEffort,
  loadMessage,
  loadMessages,
  NOT_EXPIRED_M,
  requireActiveMember,
  UUID_RE,
  validationError,
} from './messaging.shared.js';

/** Max favourites carried by an account export. */
export const EXPORT_FAVORITES_MAX = 1000;

/** A deterministic UUID per (forward request, destination): a retried forward replays instead of duplicating. */
function derivedClientId(clientId: string, conversationId: string): string {
  const h = createHash('sha256').update(`forward:${clientId}:${conversationId}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[];
    if (typeof createdAt === 'string' && typeof id === 'string' && UUID_RE.test(id) && !Number.isNaN(Date.parse(createdAt))) {
      return { createdAt, id };
    }
  } catch {
    // fall through
  }
  throw validationError('cursor', 'invalid cursor');
}

interface FavoriteRef {
  messageId: string;
  conversationId: string;
  createdAt: string;
}

/** Forwarding, message favourites and drafts (lot 3b). Message content never reaches logs or audit. */
@Injectable()
export class MessageExtrasService {
  private readonly logger = new Logger(MessageExtrasService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
  ) {}

  /* ------------------------------------------------------------------ forwarding */

  /**
   * Each destination follows every send rule (active member, blocks) and is reported on its own;
   * a refusal only says `not_found` (unknown or not a member) or `not_allowed`, never why.
   */
  async forward(userId: string, messageId: string, req: ForwardMessageRequest): Promise<ForwardMessageResponse> {
    const found = await this.messages.visibleMessage(this.db, userId, messageId);
    if (!found) throw AppError.notFound('Message not found');
    const src = found.message;
    if (src.kind === 'system') throw validationError('messageId', 'system messages cannot be forwarded');
    if (src.recalledAt) throw AppError.conflict('This message was recalled', { reason: 'recalled' });

    const destinations = [...new Set(req.conversationIds.map((c) => c.toLowerCase()))];
    const results: ForwardResult[] = [];
    for (const conversationId of destinations) {
      results.push(await this.forwardOne(userId, src, conversationId, req.clientId));
    }
    return { results };
  }

  private async forwardOne(userId: string, src: MessageRow, conversationId: string, clientId: string): Promise<ForwardResult> {
    const fail = (code: 'not_found' | 'not_allowed'): ForwardResult => ({ conversationId, status: 'error', message: null, code });
    try {
      const { conversation } = await requireActiveMember(this.db, conversationId, userId);
      if (conversation.kind === 'direct') await this.messages.assertDirectOpen(userId, conversationId);
      if (src.mediaId) {
        const [asset] = await this.db
          .select({ status: mediaAssets.status })
          .from(mediaAssets)
          .where(eq(mediaAssets.id, src.mediaId))
          .limit(1);
        if (asset?.status !== 'ready') return fail('not_allowed');
      }
      const out = await this.db.transaction((tx) =>
        insertUserMessage(tx, userId, conversationId, {
          kind: src.kind === 'media' ? 'media' : 'text',
          clientId: derivedClientId(clientId, conversationId),
          body: src.body,
          mediaId: src.mediaId,
          replyToId: null,
          mentions: [],
          forwarded: true,
        }),
      );
      const message = await loadMessage(this.db, out.row, userId);
      if (out.created) await this.messages.afterSend(userId, conversation, out.row, message);
      return { conversationId, status: 'sent', message, code: null };
    } catch (err) {
      if (err instanceof AppError) return fail(err.status === 404 ? 'not_found' : 'not_allowed');
      throw err;
    }
  }

  /* ------------------------------------------------------------------ favourites */

  async addFavorite(userId: string, messageId: string): Promise<void> {
    const found = await this.messages.visibleMessage(this.db, userId, messageId);
    if (!found) throw AppError.notFound('Message not found');
    const m = found.message;
    if (m.kind === 'system') throw validationError('messageId', 'system messages cannot be favourited');
    if (m.recalledAt) throw AppError.conflict('This message was recalled', { reason: 'recalled' });
    if (m.senderId && m.senderId !== userId) {
      const blocked = await this.db.execute(sql`
        SELECT 1 FROM user_blocks
        WHERE (blocker_id = ${userId} AND blocked_id = ${m.senderId}) OR (blocker_id = ${m.senderId} AND blocked_id = ${userId})
        LIMIT 1`);
      if (blocked.rows.length > 0) throw AppError.notFound('Message not found');
    }
    await this.db.insert(messageFavorites).values({ userId, messageId: m.id }).onConflictDoNothing();
  }

  async removeFavorite(userId: string, messageId: string): Promise<void> {
    if (!UUID_RE.test(messageId)) return;
    await this.db.delete(messageFavorites).where(and(eq(messageFavorites.userId, userId), eq(messageFavorites.messageId, messageId)));
  }

  /**
   * Favourites the user can still reach: an active member, message after their entry, not recalled,
   * expired, hidden for them, nor sent by someone blocked either way. Others stay stored but masked.
   */
  private async accessible(userId: string, limit: number, cursor?: string): Promise<FavoriteRef[]> {
    const cur = cursor ? decodeCursor(cursor) : undefined;
    const res = await this.db.execute<{ message_id: string; conversation_id: string; cur: string }>(sql`
      SELECT f.message_id, m.conversation_id, f.created_at::text AS cur
      FROM message_favorites f
      JOIN messages m ON m.id = f.message_id
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = f.user_id AND cm.status = 'active'
      WHERE f.user_id = ${userId} AND m.seq >= cm.first_seq AND m.recalled_at IS NULL AND m.kind <> 'system' AND ${NOT_EXPIRED_M}
        AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = f.user_id)
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = f.user_id AND b.blocked_id = m.sender_id) OR (b.blocker_id = m.sender_id AND b.blocked_id = f.user_id))
        ${cur ? sql`AND (f.created_at, f.message_id) < (${cur.createdAt}::timestamptz, ${cur.id}::uuid)` : sql``}
      ORDER BY f.created_at DESC, f.message_id DESC
      LIMIT ${limit}`);
    return res.rows.map((r) => ({ messageId: r.message_id, conversationId: r.conversation_id, createdAt: r.cur }));
  }

  async listFavorites(userId: string, q: FavoriteListQuery): Promise<FavoriteList> {
    const refs = await this.accessible(userId, q.limit + 1, q.cursor);
    const page = refs.slice(0, q.limit);
    const rows = page.length === 0 ? [] : await this.db.select().from(messages).where(inArray(messages.id, page.map((r) => r.messageId)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const dtos = new Map((await loadMessages(this.db, rows, userId)).map((m) => [m.id, m]));
    const last = page.at(-1);
    return {
      items: page.flatMap((r) => {
        const message = dtos.get(r.messageId);
        return message && byId.has(r.messageId) ? [{ message, favoritedAt: new Date(r.createdAt).toISOString() }] : [];
      }),
      nextCursor: refs.length > q.limit && last ? encodeCursor(last.createdAt, last.messageId) : null,
    };
  }

  /** For the account export: accessible favourites with their text. */
  async exportFavorites(userId: string): Promise<{ messageId: string; conversationId: string; body: string | null; favoritedAt: string }[]> {
    const refs = await this.accessible(userId, EXPORT_FAVORITES_MAX);
    if (refs.length === 0) return [];
    const rows = await this.db.select({ id: messages.id, body: messages.body }).from(messages).where(inArray(messages.id, refs.map((r) => r.messageId)));
    const bodyById = new Map(rows.map((r) => [r.id, r.body]));
    return refs.map((r) => ({
      messageId: r.messageId,
      conversationId: r.conversationId,
      body: bodyById.get(r.messageId) ?? null,
      favoritedAt: new Date(r.createdAt).toISOString(),
    }));
  }

  /* ------------------------------------------------------------------ drafts */

  async putDraft(userId: string, conversationId: string, body: string): Promise<Draft> {
    await requireActiveMember(this.db, conversationId, userId);
    const [row] = await this.db
      .insert(conversationDrafts)
      .values({ conversationId, userId, body })
      .onConflictDoUpdate({
        target: [conversationDrafts.conversationId, conversationDrafts.userId],
        set: { body, updatedAt: sql`now()` },
      })
      .returning();
    const draft: Draft = { conversationId, body: row!.body, updatedAt: row!.updatedAt.toISOString() };
    await bestEffort(this.logger, 'draft event', () => this.realtime.emitToUser(userId, 'draft.updated', draft));
    return draft;
  }

  async getDraft(userId: string, conversationId: string): Promise<Draft> {
    await requireActiveMember(this.db, conversationId, userId);
    const [row] = await this.db
      .select()
      .from(conversationDrafts)
      .where(and(eq(conversationDrafts.conversationId, conversationId), eq(conversationDrafts.userId, userId)))
      .limit(1);
    if (!row) throw AppError.notFound('Draft not found');
    return { conversationId, body: row.body, updatedAt: row.updatedAt.toISOString() };
  }

  async deleteDraft(userId: string, conversationId: string): Promise<void> {
    if (!UUID_RE.test(conversationId)) return;
    const res = await this.db
      .delete(conversationDrafts)
      .where(and(eq(conversationDrafts.conversationId, conversationId), eq(conversationDrafts.userId, userId)));
    if ((res.rowCount ?? 0) > 0) {
      await bestEffort(this.logger, 'draft event', () =>
        this.realtime.emitToUser(userId, 'draft.updated', { conversationId, body: null }),
      );
    }
  }
}
