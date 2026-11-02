// Lot 3 notification tables (0008). Owned by the notifications module.
import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const pushTokens = pgTable('push_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  token: text('token').notNull().unique(),
  platform: text('platform').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
  lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: jsonb('data').$type<Record<string, string>>().notNull().default({}),
  readAt: tstz('read_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id').primaryKey(),
  pushDisabledCategories: text('push_disabled_categories').array().notNull().default([]),
  quietUntil: tstz('quiet_until'),
  messagePreviews: boolean('message_previews').notNull().default(false),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
