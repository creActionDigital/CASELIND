// Conversation polls (0067_polls_presence.sql is the source of truth; keep this mirror in sync).
import { boolean, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const messagePolls = pgTable('message_polls', {
  messageId: uuid('message_id').primaryKey(),
  creatorId: uuid('creator_id'),
  question: text('question').notNull(),
  multiple: boolean('multiple').notNull().default(false),
  closesAt: tstz('closes_at'),
  closedAt: tstz('closed_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
export type MessagePollRow = typeof messagePolls.$inferSelect;

export const messagePollOptions = pgTable('message_poll_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull(),
  position: smallint('position').notNull(),
  label: text('label').notNull(),
});

export const messagePollVotes = pgTable(
  'message_poll_votes',
  {
    optionId: uuid('option_id').notNull(),
    messageId: uuid('message_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.optionId, t.userId] })],
);
