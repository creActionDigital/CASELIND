import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

// Lot 4A: follows, posts, feed, reactions, comments.

export const postVisibilitySchema = z.enum(['public', 'followers', 'friends', 'private']);
export type PostVisibility = z.infer<typeof postVisibilitySchema>;

export const postKindSchema = z.enum(['text', 'media', 'video']);
export type PostKind = z.infer<typeof postKindSchema>;

export const reactionTypeSchema = z.enum(['like', 'love', 'haha', 'wow', 'sad', 'angry']);
export type ReactionType = z.infer<typeof reactionTypeSchema>;

export const socialPageQuerySchema = pageQuerySchema;
export type SocialPageQuery = z.infer<typeof socialPageQuerySchema>;

// ---- follows ---------------------------------------------------------------------------------

export const socialUserSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  /** When the follow relation (in the listed direction) was created. */
  followedAt: z.iso.datetime(),
});
export type SocialUser = z.infer<typeof socialUserSchema>;

export const socialUserListSchema = z.object({ items: z.array(socialUserSchema), nextCursor: z.string().nullable() });
export type SocialUserList = z.infer<typeof socialUserListSchema>;

/** GET /v1/users/:userId/social */
export const socialStatsSchema = z.object({
  userId: z.uuid(),
  followersCount: z.number().int().min(0),
  followingCount: z.number().int().min(0),
  /** The caller follows this user. */
  isFollowing: z.boolean(),
  /** This user follows the caller. */
  followsYou: z.boolean(),
});
export type SocialStats = z.infer<typeof socialStatsSchema>;

// ---- posts -----------------------------------------------------------------------------------

export const postMediaSchema = z.object({
  id: z.uuid(),
  mime: z.string().nullable(),
  contentUrl: z.string(),
});

export const postAuthorSchema = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

const postBodySchema = z.string().trim().min(1).max(5000);

export const createPostRequestSchema = z
  .object({
    clientId: z.uuid(),
    body: postBodySchema.optional(),
    mediaIds: z.array(z.uuid()).max(10).default([]),
    visibility: postVisibilitySchema,
  })
  .refine((v) => v.body !== undefined || v.mediaIds.length > 0, {
    path: ['body'],
    message: 'a post needs a text or at least one media',
  })
  .refine((v) => new Set(v.mediaIds).size === v.mediaIds.length, {
    path: ['mediaIds'],
    message: 'duplicate media',
  });
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;

/** Text and visibility only; `body: null` clears the text (the post must keep a media). */
export const updatePostRequestSchema = z
  .object({
    body: postBodySchema.nullable().optional(),
    visibility: postVisibilitySchema.optional(),
  })
  .refine((v) => v.body !== undefined || v.visibility !== undefined, { message: 'nothing to update' });
export type UpdatePostRequest = z.infer<typeof updatePostRequestSchema>;

export const reactionCountsSchema = z.object({
  like: z.number().int().min(0),
  love: z.number().int().min(0),
  haha: z.number().int().min(0),
  wow: z.number().int().min(0),
  sad: z.number().int().min(0),
  angry: z.number().int().min(0),
});
export type ReactionCounts = z.infer<typeof reactionCountsSchema>;

export const postSchema = z.object({
  id: z.uuid(),
  author: postAuthorSchema,
  kind: postKindSchema,
  body: z.string().nullable(),
  visibility: postVisibilitySchema,
  media: z.array(postMediaSchema),
  reactions: reactionCountsSchema,
  myReaction: reactionTypeSchema.nullable(),
  commentsCount: z.number().int().min(0),
  /** The caller saved this post (always sent by the API; optional here for older fixtures). */
  bookmarked: z.boolean().optional(),
  /** True only on a boosted post inserted in the feed: the client MUST label it "Sponsorisé". */
  sponsored: z.boolean().optional(),
  /** `hidden` when moderation hid it: only the author and moderators can still see it. */
  moderation: z.enum(['visible', 'hidden']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Post = z.infer<typeof postSchema>;

export const postListSchema = z.object({ items: z.array(postSchema), nextCursor: z.string().nullable() });
export type PostList = z.infer<typeof postListSchema>;

export const setReactionRequestSchema = z.object({ type: reactionTypeSchema.nullable() });
export type SetReactionRequest = z.infer<typeof setReactionRequestSchema>;

// ---- comments --------------------------------------------------------------------------------

export const createCommentRequestSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  /** A top-level comment of the same post (replies are one level deep). */
  replyToId: z.uuid().optional(),
});
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

export const commentSchema = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  author: postAuthorSchema,
  body: z.string(),
  replyToId: z.uuid().nullable(),
  moderation: z.enum(['visible', 'hidden']),
  createdAt: z.iso.datetime(),
});
export type Comment = z.infer<typeof commentSchema>;

export const commentListSchema = z.object({ items: z.array(commentSchema), nextCursor: z.string().nullable() });
export type CommentList = z.infer<typeof commentListSchema>;

// ---- account export --------------------------------------------------------------------------

export const exportedPostSchema = z.object({
  id: z.uuid(),
  body: z.string().nullable(),
  visibility: postVisibilitySchema,
  createdAt: z.iso.datetime(),
});
export const exportedCommentSchema = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export const exportedFollowSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  followedAt: z.iso.datetime(),
});
