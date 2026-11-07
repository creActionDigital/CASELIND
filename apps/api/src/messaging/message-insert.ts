import { and, eq, sql } from 'drizzle-orm';
import { conversationDrafts, conversationMembers, messages, type MessageRow } from '../db/schema.js';
import { activeMemberRow, conversationNotFound, type Exec, lockConversation, nextSeq } from './messaging.shared.js';

export interface NewUserMessage {
  kind: 'text' | 'media';
  clientId: string;
  body: string | null;
  mediaId: string | null;
  replyToId: string | null;
  mentions: string[];
  forwarded?: boolean;
  /** Sending in a conversation consumes the sender's draft there (not for a forward). */
  clearDraft?: boolean;
}

/**
 * Inserts a user message inside the caller's transaction: locks the conversation, re-checks the
 * membership, honours idempotency per (sender, conversation, clientId), attributes the seq, applies the
 * conversation's disappearing setting and updates the receipts. Throws the 404 when no longer a member.
 */
export async function insertUserMessage(
  tx: Exec,
  userId: string,
  conversationId: string,
  m: NewUserMessage,
): Promise<{ row: MessageRow; created: boolean }> {
  const conv = await lockConversation(tx, conversationId);
  if (!(await activeMemberRow(tx, conversationId, userId))) throw conversationNotFound();
  const [dup] = await tx
    .select()
    .from(messages)
    .where(and(eq(messages.senderId, userId), eq(messages.conversationId, conversationId), eq(messages.clientId, m.clientId)))
    .limit(1);
  if (dup) return { row: dup, created: false };

  const seq = await nextSeq(tx, conversationId);
  const [row] = await tx
    .insert(messages)
    .values({
      conversationId,
      seq,
      senderId: userId,
      kind: m.kind,
      clientId: m.clientId,
      body: m.body,
      mediaId: m.mediaId,
      replyToId: m.replyToId,
      mentions: m.mentions,
      forwarded: m.forwarded ?? false,
      expiresAt: conv.disappearingSeconds ? sql`now() + make_interval(secs => ${conv.disappearingSeconds})` : null,
    })
    .returning();
  // Writing implies having seen everything so far.
  await tx
    .update(conversationMembers)
    .set({ lastDeliveredSeq: seq, lastReadSeq: seq })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  // A new message brings the conversation back for those who archived it.
  await tx
    .update(conversationMembers)
    .set({ archived: false })
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.status, 'active'),
        eq(conversationMembers.archived, true),
        sql`${conversationMembers.userId} <> ${userId}`,
      ),
    );
  if (m.clearDraft) {
    await tx
      .delete(conversationDrafts)
      .where(and(eq(conversationDrafts.conversationId, conversationId), eq(conversationDrafts.userId, userId)));
  }
  return { row: row!, created: true };
}
