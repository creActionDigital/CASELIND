import { Inject, Injectable } from '@nestjs/common';
import type { MessageSearchQuery, MessageSearchResult } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { decodeCursor, encodeCursor } from './message-extras.service.js';
import { NOT_EXPIRED_M, requireActiveMember } from './messaging.shared.js';

const SNIPPET_BEFORE = 30;
const SNIPPET_LENGTH = 120;

/** `%`, `_` and `\` in the user's text are literals (LIKE's default escape character is the backslash). */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A short excerpt around the first (case-insensitive) match. */
export function snippetAround(body: string, q: string): string {
  const at = Math.max(0, body.toLowerCase().indexOf(q.toLowerCase()));
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const text = body.slice(start, start + SNIPPET_LENGTH).replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${text}${start + SNIPPET_LENGTH < body.length ? '…' : ''}`;
}

/**
 * Search in the text of the caller's messages. Only conversations they are an active member of, after
 * their entry, minus recalled / expired / hidden-for-me / system messages and senders blocked either way.
 * ILIKE scan bounded by the member's conversations (no trigram index: the extension is optional here).
 */
@Injectable()
export class MessageSearchService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async search(userId: string, q: MessageSearchQuery): Promise<MessageSearchResult> {
    if (q.conversationId) await requireActiveMember(this.db, q.conversationId, userId);
    const cur = q.cursor ? decodeCursor(q.cursor) : undefined;
    const res = await this.db.execute<{
      id: string;
      conversation_id: string;
      seq: string;
      body: string;
      sender_id: string | null;
      created_at: Date;
      cur: string;
      kind: 'direct' | 'group';
      title: string | null;
    }>(sql`
      SELECT m.id, m.conversation_id, m.seq, m.body, m.sender_id, m.created_at, m.created_at::text AS cur, c.kind,
        CASE WHEN c.kind = 'direct'
          THEN (SELECT u.display_name FROM conversation_members p JOIN users u ON u.id = p.user_id
                WHERE p.conversation_id = c.id AND p.user_id <> cm.user_id ORDER BY p.joined_at LIMIT 1)
          ELSE c.title END AS title
      FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${userId} AND cm.status = 'active'
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.seq >= cm.first_seq AND m.kind <> 'system' AND m.recalled_at IS NULL AND m.body ILIKE ${`%${escapeLike(q.q)}%`}
        AND ${NOT_EXPIRED_M}
        AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.message_id = m.id AND h.user_id = ${userId})
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${userId} AND b.blocked_id = m.sender_id) OR (b.blocker_id = m.sender_id AND b.blocked_id = ${userId}))
        ${q.conversationId ? sql`AND m.conversation_id = ${q.conversationId}` : sql``}
        ${cur ? sql`AND (m.created_at, m.id) < (${cur.createdAt}::timestamptz, ${cur.id}::uuid)` : sql``}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${q.limit + 1}`);
    const page = res.rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        messageId: r.id,
        conversationId: r.conversation_id,
        conversationKind: r.kind,
        conversationTitle: r.title,
        seq: Number(r.seq),
        snippet: snippetAround(r.body, q.q),
        senderId: r.sender_id,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.cur, last.id) : null,
    };
  }
}
