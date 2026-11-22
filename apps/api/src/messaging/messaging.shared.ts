import type { Logger } from '@nestjs/common';
import { ErrorCodes, type Message, type Poll, type SystemEvent } from '@caselind/contracts';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { Db } from '../db/db.module.js';
import {
  type ConversationMemberRow,
  conversationMembers,
  type ConversationRow,
  conversations,
  mediaAssets,
  type MessageRow,
  messageFavorites,
  messagePollOptions,
  messagePolls,
  messagePollVotes,
  messageReactions,
  messages,
} from '../db/schema.js';
import { contentUrlOf } from '../media/media.service.js';

/** The query surface shared by the pool-backed database and a transaction. */
export type Exec = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** SQL predicate: the message of alias `m` has not expired (disappearing messages are never served past expires_at). */
export const NOT_EXPIRED_M = sql`(m.expires_at IS NULL OR m.expires_at > now())`;

/** Any syntactically valid UUID (what Postgres accepts); anything else cannot name a row. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const conversationNotFound = () => AppError.notFound('Conversation not found');
export const userNotFound = () => AppError.notFound('User not found');

export function validationError(path: string, message: string): AppError {
  return new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
}

/** `ARRAY['..', '..']::uuid[]` for raw SQL (an empty list gives an empty array). */
export function uuidArray(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`ARRAY[]::uuid[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}

/** Key of the single direct conversation of a pair, independent of the order of the two ids. */
export function directKeyOf(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x}:${y}`;
}

/** The caller's ACTIVE membership; a non-member, a former member or a malformed id is a plain 404. */
export async function requireActiveMember(
  exec: Exec,
  conversationId: string,
  userId: string,
): Promise<{ conversation: ConversationRow; member: ConversationMemberRow }> {
  if (!UUID_RE.test(conversationId)) throw conversationNotFound();
  const [row] = await exec
    .select({ conversation: conversations, member: conversationMembers })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
        eq(conversationMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (!row) throw conversationNotFound();
  return row;
}

/** Locks the conversation row (serialises sequence numbers and membership changes). 404 if gone. */
export async function lockConversation(exec: Exec, conversationId: string): Promise<ConversationRow> {
  const [row] = await exec.select().from(conversations).where(eq(conversations.id, conversationId)).for('update');
  if (!row) throw conversationNotFound();
  return row;
}

/** Same members, same row, but only if still active (after the lock was granted). */
export async function activeMemberRow(
  exec: Exec,
  conversationId: string,
  userId: string,
): Promise<ConversationMemberRow | undefined> {
  const [row] = await exec
    .select()
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
        eq(conversationMembers.status, 'active'),
      ),
    )
    .limit(1);
  return row;
}

/** Attributes the next sequence number. The conversation row must be locked by the caller. */
export async function nextSeq(exec: Exec, conversationId: string): Promise<number> {
  const [row] = await exec
    .update(conversations)
    .set({ lastSeq: sql`${conversations.lastSeq} + 1`, lastMessageAt: sql`now()` })
    .where(eq(conversations.id, conversationId))
    .returning({ seq: conversations.lastSeq });
  return row!.seq;
}

/** Appends a server-generated message (membership change, title change...). Conversation locked. */
export async function appendSystemMessage(
  exec: Exec,
  conversationId: string,
  event: SystemEvent,
): Promise<MessageRow> {
  const seq = await nextSeq(exec, conversationId);
  const [row] = await exec
    .insert(messages)
    .values({ conversationId, seq, kind: 'system', senderId: null, systemEvent: event })
    .returning();
  return row!;
}

/**
 * Message DTOs for a page of rows: media and reaction aggregates are fetched in two queries.
 * `viewerId` null = realtime/broadcast shape (no per-user field).
 */
export async function loadMessages(exec: Exec, rows: MessageRow[], viewerId: string | null): Promise<Message[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const mediaIds = rows.map((r) => r.mediaId).filter((v): v is string => v !== null);
  const mediaRows =
    mediaIds.length === 0
      ? []
      : await exec
          .select({ id: mediaAssets.id, mime: mediaAssets.mime, sizeBytes: mediaAssets.sizeBytes, fileName: mediaAssets.fileName, durationSec: mediaAssets.durationSec, status: mediaAssets.status })
          .from(mediaAssets)
          .where(inArray(mediaAssets.id, mediaIds));
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));
  const reactionRows = await exec
    .select({ messageId: messageReactions.messageId, userId: messageReactions.userId, emoji: messageReactions.emoji })
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, ids));
  const favRows =
    viewerId === null
      ? []
      : await exec
          .select({ messageId: messageFavorites.messageId })
          .from(messageFavorites)
          .where(and(eq(messageFavorites.userId, viewerId), inArray(messageFavorites.messageId, ids)));
  const favorited = new Set(favRows.map((f) => f.messageId));
  const polls = await loadPolls(exec, rows, viewerId);
  const byMessage = new Map<string, { counts: Map<string, number>; mine: string | null }>();
  for (const r of reactionRows) {
    const entry = byMessage.get(r.messageId) ?? { counts: new Map(), mine: null };
    entry.counts.set(r.emoji, (entry.counts.get(r.emoji) ?? 0) + 1);
    if (viewerId !== null && r.userId === viewerId) entry.mine = r.emoji;
    byMessage.set(r.messageId, entry);
  }
  return rows.map((row) => {
    const recalled = row.recalledAt !== null;
    const media = row.mediaId ? mediaById.get(row.mediaId) : undefined;
    const reactions = byMessage.get(row.id);
    return {
      id: row.id,
      conversationId: row.conversationId,
      seq: row.seq,
      kind: row.kind,
      senderId: row.senderId,
      clientId: row.clientId,
      body: recalled ? null : row.body,
      media:
        !recalled && media
          ? {
              id: media.id,
              mime: media.mime,
              sizeBytes: media.sizeBytes,
              fileName: media.fileName,
              durationSec: media.durationSec,
              contentUrl: media.status === 'ready' ? contentUrlOf(media.id) : null,
            }
          : null,
      replyToId: row.replyToId,
      mentions: recalled ? [] : row.mentions,
      systemEvent: (row.systemEvent as SystemEvent | null) ?? null,
      recalled,
      reactions: recalled || !reactions ? [] : [...reactions.counts].map(([emoji, count]) => ({ emoji, count })),
      myReaction: recalled ? null : (reactions?.mine ?? null),
      createdAt: row.createdAt.toISOString(),
      forwarded: row.forwarded,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      favorited: favorited.has(row.id),
      poll: recalled ? null : (polls.get(row.id) ?? null),
    };
  });
}

/** Counters per option, voters, and (for a known viewer) their own votes. Voters are never named. */
export async function loadPolls(exec: Exec, rows: MessageRow[], viewerId: string | null): Promise<Map<string, Poll>> {
  const out = new Map<string, Poll>();
  const ids = rows.filter((r) => r.kind === 'poll' && !r.recalledAt).map((r) => r.id);
  if (ids.length === 0) return out;
  const pollRows = await exec.select().from(messagePolls).where(inArray(messagePolls.messageId, ids));
  const options = await exec
    .select()
    .from(messagePollOptions)
    .where(inArray(messagePollOptions.messageId, ids))
    .orderBy(messagePollOptions.messageId, messagePollOptions.position);
  const counts = await exec
    .select({ optionId: messagePollVotes.optionId, n: sql<number>`count(*)::int` })
    .from(messagePollVotes)
    .where(inArray(messagePollVotes.messageId, ids))
    .groupBy(messagePollVotes.optionId);
  const voterRows = await exec
    .select({ messageId: messagePollVotes.messageId, n: sql<number>`count(DISTINCT ${messagePollVotes.userId})::int` })
    .from(messagePollVotes)
    .where(inArray(messagePollVotes.messageId, ids))
    .groupBy(messagePollVotes.messageId);
  const mine =
    viewerId === null
      ? []
      : await exec
          .select({ optionId: messagePollVotes.optionId })
          .from(messagePollVotes)
          .where(and(eq(messagePollVotes.userId, viewerId), inArray(messagePollVotes.messageId, ids)));
  const countOf = new Map(counts.map((c) => [c.optionId, c.n]));
  const votersOf = new Map(voterRows.map((v) => [v.messageId, v.n]));
  const myVotes = mine.map((v) => v.optionId);
  const now = Date.now();
  for (const p of pollRows) {
    const opts = options.filter((o) => o.messageId === p.messageId);
    const optionIds = new Set(opts.map((o) => o.id));
    out.set(p.messageId, {
      question: p.question,
      multiple: p.multiple,
      options: opts.map((o) => ({ id: o.id, label: o.label, votes: countOf.get(o.id) ?? 0 })),
      voters: votersOf.get(p.messageId) ?? 0,
      closesAt: p.closesAt?.toISOString() ?? null,
      closed: p.closedAt !== null || (p.closesAt !== null && p.closesAt.getTime() <= now),
      myVotes: myVotes.filter((id) => optionIds.has(id)),
    });
  }
  return out;
}

export async function loadMessage(exec: Exec, row: MessageRow, viewerId: string | null): Promise<Message> {
  return (await loadMessages(exec, [row], viewerId))[0]!;
}

/**
 * Post-commit side effects (events, pushes) must never fail the request whose transaction already
 * committed, nor skip what comes after them. Logged by name only: errors may carry query parameters.
 */
export async function bestEffort(logger: Logger, what: string, fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn(`${what} failed: ${(err as Error).name}`);
  }
}
