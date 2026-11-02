// Lot 4A social tables (0009_social.sql is the source of truth; keep this mirror in sync).
import { boolean, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id').notNull(),
    followeeId: uuid('followee_id').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] })],
);

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id').notNull(),
  clientId: uuid('client_id').notNull(),
  kind: text('kind').$type<'text' | 'media' | 'video'>().notNull(),
  body: text('body'),
  visibility: text('visibility').$type<'public' | 'followers' | 'friends' | 'private'>().notNull(),
  hidden: boolean('hidden').notNull().default(false),
  deletedAt: tstz('deleted_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
export type PostRow = typeof posts.$inferSelect;

export const postMedia = pgTable(
  'post_media',
  {
    postId: uuid('post_id').notNull(),
    mediaId: uuid('media_id').notNull(),
    position: smallint('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.position] })],
);

export const postReactions = pgTable(
  'post_reactions',
  {
    postId: uuid('post_id').notNull(),
    userId: uuid('user_id').notNull(),
    type: text('type').$type<'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry'>().notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const postComments = pgTable('post_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').notNull(),
  authorId: uuid('author_id').notNull(),
  replyToId: uuid('reply_to_id'),
  body: text('body').notNull(),
  hidden: boolean('hidden').notNull().default(false),
  deletedAt: tstz('deleted_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
export type PostCommentRow = typeof postComments.$inferSelect;
