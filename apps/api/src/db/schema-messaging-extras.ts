// Lot 3b tables (0017_messaging_extras.sql is the source of truth; keep this mirror in sync).
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const messageFavorites = pgTable(
  'message_favorites',
  {
    userId: uuid('user_id').notNull(),
    messageId: uuid('message_id').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.messageId] })],
);

export const scheduledMessages = pgTable('scheduled_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull(),
  senderId: uuid('sender_id').notNull(),
  clientId: uuid('client_id').notNull(),
  kind: text('kind').$type<'text' | 'media'>().notNull(),
  body: text('body'),
  mediaId: uuid('media_id'),
  replyToId: uuid('reply_to_id'),
  mentions: uuid('mentions').array().notNull().default([]),
  scheduledAt: tstz('scheduled_at').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
export type ScheduledMessageRow = typeof scheduledMessages.$inferSelect;

export const conversationDrafts = pgTable(
  'conversation_drafts',
  {
    conversationId: uuid('conversation_id').notNull(),
    userId: uuid('user_id').notNull(),
    body: text('body').notNull(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);
