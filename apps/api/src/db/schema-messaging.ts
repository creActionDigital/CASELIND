// Lot 3 messaging tables (0007_messaging.sql is the source of truth; keep this mirror in sync).
import { bigint, boolean, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').$type<'direct' | 'group'>().notNull(),
  directKey: text('direct_key'),
  title: text('title'),
  announcement: text('announcement'),
  avatarUrl: text('avatar_url'),
  createdBy: uuid('created_by'),
  /** mode number: a conversation will never reach 2^53 messages. */
  lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
  lastMessageAt: tstz('last_message_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
export type ConversationRow = typeof conversations.$inferSelect;

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').$type<'owner' | 'admin' | 'member'>().notNull().default('member'),
    status: text('status').$type<'active' | 'left'>().notNull().default('active'),
    joinedAt: tstz('joined_at').notNull().defaultNow(),
    leftAt: tstz('left_at'),
    firstSeq: bigint('first_seq', { mode: 'number' }).notNull().default(1),
    lastDeliveredSeq: bigint('last_delivered_seq', { mode: 'number' }).notNull().default(0),
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    mutedUntil: tstz('muted_until'),
    pinned: boolean('pinned').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);
export type ConversationMemberRow = typeof conversationMembers.$inferSelect;

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull(),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  senderId: uuid('sender_id'),
  kind: text('kind').$type<'text' | 'media' | 'system'>().notNull(),
  clientId: uuid('client_id'),
  body: text('body'),
  mediaId: uuid('media_id'),
  replyToId: uuid('reply_to_id'),
  mentions: uuid('mentions').array().notNull().default([]),
  systemEvent: jsonb('system_event'),
  recalledAt: tstz('recalled_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
export type MessageRow = typeof messages.$inferSelect;

export const messageHidden = pgTable(
  'message_hidden',
  {
    messageId: uuid('message_id').notNull(),
    userId: uuid('user_id').notNull(),
    hiddenAt: tstz('hidden_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id').notNull(),
    userId: uuid('user_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);
