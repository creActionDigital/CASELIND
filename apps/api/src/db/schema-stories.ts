// Lot 4B tables (0010_stories_moderation.sql is the source of truth; keep this mirror in sync).
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const stories = pgTable('stories', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').notNull(),
  clientId: uuid('client_id').notNull(),
  mediaId: uuid('media_id').notNull(),
  caption: text('caption'),
  visibility: text('visibility').$type<'followers' | 'friends'>().notNull().default('followers'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  expiresAt: tstz('expires_at').notNull(),
  hiddenAt: tstz('hidden_at'),
});
export type StoryRow = typeof stories.$inferSelect;

export const storyViews = pgTable(
  'story_views',
  {
    storyId: uuid('story_id').notNull(),
    viewerId: uuid('viewer_id').notNull(),
    viewedAt: tstz('viewed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.viewerId] })],
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id'),
  targetType: text('target_type').$type<'user' | 'post' | 'comment' | 'story' | 'message' | 'product' | 'review' | 'service' | 'service_review' | 'ride' | 'listing'>().notNull(),
  targetId: uuid('target_id').notNull(),
  reason: text('reason').notNull(),
  details: text('details'),
  status: text('status').$type<'open' | 'resolved'>().notNull().default('open'),
  resolution: text('resolution').$type<'hide' | 'restore' | 'dismiss'>(),
  createdAt: tstz('created_at').notNull().defaultNow(),
  resolvedAt: tstz('resolved_at'),
  resolvedBy: uuid('resolved_by'),
});
export type ReportRow = typeof reports.$inferSelect;
