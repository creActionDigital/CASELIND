import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/* Lot 4B: stories (24 h), reports and moderation. See docs/architecture/API_CONTRACTS.md. */

export const STORY_CAPTION_MAX = 500;
export const REPORT_DETAILS_MAX = 1000;
export const STORY_FEED_AUTHORS_MAX = 100;

/** `closeFriends` (private list) is an open point: only followers and friends exist for now. */
export const storyVisibilitySchema = z.enum(['followers', 'friends']);
export type StoryVisibility = z.infer<typeof storyVisibilitySchema>;

export const createStoryRequestSchema = z.object({
  /** Idempotency key: a retry with the same clientId returns the stored story. */
  clientId: z.uuid(),
  /** A ready upload of the caller with purpose "story". */
  mediaId: z.uuid(),
  caption: z.string().trim().max(STORY_CAPTION_MAX).optional(),
  visibility: storyVisibilitySchema.default('followers'),
});
export type CreateStoryRequest = z.infer<typeof createStoryRequestSchema>;

export const storyAuthorSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type StoryAuthor = z.infer<typeof storyAuthorSchema>;

export const storySchema = z.object({
  id: z.uuid(),
  authorId: z.uuid(),
  mediaId: z.uuid(),
  mediaUrl: z.string(),
  caption: z.string().nullable(),
  visibility: storyVisibilitySchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** Whether the caller has seen it (always true for the author's own stories). */
  seen: z.boolean(),
  /** Author only: number of distinct viewers. Null for other viewers. */
  viewCount: z.number().int().nullable(),
});
export type Story = z.infer<typeof storySchema>;

export const storyListSchema = z.object({ items: z.array(storySchema) });
export type StoryList = z.infer<typeof storyListSchema>;

export const storyPageSchema = z.object({ items: z.array(storySchema), nextCursor: z.string().nullable() });
export type StoryPage = z.infer<typeof storyPageSchema>;

export const storyGroupSchema = z.object({
  author: storyAuthorSchema,
  /** Oldest first, as they play. */
  stories: z.array(storySchema),
  hasUnseen: z.boolean(),
});
export type StoryGroup = z.infer<typeof storyGroupSchema>;

/** The stories bar: the caller first, then followed accounts, unseen first. At most 100 authors. */
export const storyFeedSchema = z.object({ items: z.array(storyGroupSchema) });
export type StoryFeed = z.infer<typeof storyFeedSchema>;

export const storyPageQuerySchema = pageQuerySchema;
export type StoryPageQuery = z.infer<typeof storyPageQuerySchema>;

export const storyViewerSchema = storyAuthorSchema.extend({ viewedAt: z.iso.datetime() });
export type StoryViewer = z.infer<typeof storyViewerSchema>;
export const storyViewerListSchema = z.object({ items: z.array(storyViewerSchema), nextCursor: z.string().nullable() });
export type StoryViewerList = z.infer<typeof storyViewerListSchema>;

/* ------------------------------------------------------------------ reports */

export const reportTargetTypeSchema = z.enum(['user', 'post', 'comment', 'story', 'message', 'product', 'review', 'service', 'service_review', 'ride', 'listing', 'job', 'mission', 'course', 'course_review']);
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>;

export const reportReasonSchema = z.enum(['spam', 'harassment', 'hate', 'violence', 'nudity', 'scam', 'illegal', 'other']);
export type ReportReason = z.infer<typeof reportReasonSchema>;

export const createReportRequestSchema = z.object({
  targetType: reportTargetTypeSchema,
  targetId: z.uuid(),
  reason: reportReasonSchema,
  details: z.string().trim().max(REPORT_DETAILS_MAX).optional(),
});
export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;

export const moderationActionSchema = z.enum(['hide', 'restore', 'dismiss']);
export type ModerationAction = z.infer<typeof moderationActionSchema>;

export const reportSchema = z.object({
  id: z.uuid(),
  targetType: reportTargetTypeSchema,
  targetId: z.uuid(),
  reason: reportReasonSchema,
  details: z.string().nullable(),
  status: z.enum(['open', 'resolved']),
  /** Never reveals who was sanctioned, only that the report was handled. */
  resolved: z.boolean(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type Report = z.infer<typeof reportSchema>;

export const reportPageSchema = z.object({ items: z.array(reportSchema), nextCursor: z.string().nullable() });
export type ReportPage = z.infer<typeof reportPageSchema>;

/* ------------------------------------------------------------------ moderation (admin, moderator) */

export const moderationReportsQuerySchema = z.object({
  status: z.enum(['open', 'resolved']).default('open'),
  targetType: reportTargetTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
export type ModerationReportsQuery = z.infer<typeof moderationReportsQuerySchema>;

export const moderationReportGroupSchema = z.object({
  targetType: reportTargetTypeSchema,
  targetId: z.uuid(),
  status: z.enum(['open', 'resolved']),
  reportCount: z.number().int(),
  reasons: z.array(z.object({ reason: reportReasonSchema, count: z.number().int() })),
  authorId: z.uuid().nullable(),
  firstReportedAt: z.iso.datetime(),
  lastReportedAt: z.iso.datetime(),
});
export type ModerationReportGroup = z.infer<typeof moderationReportGroupSchema>;

export const moderationReportGroupPageSchema = z.object({
  items: z.array(moderationReportGroupSchema),
  nextCursor: z.string().nullable(),
});
export type ModerationReportGroupPage = z.infer<typeof moderationReportGroupPageSchema>;

export const moderationActionRequestSchema = z.object({
  targetType: reportTargetTypeSchema,
  targetId: z.uuid(),
  action: moderationActionSchema,
  /** Internal note, kept out of the audit log. */
  note: z.string().trim().max(500).optional(),
});
export type ModerationActionRequest = z.infer<typeof moderationActionRequestSchema>;

export const moderationActionResultSchema = z.object({ resolvedReports: z.number().int() });
export type ModerationActionResult = z.infer<typeof moderationActionResultSchema>;

/* ------------------------------------------------------------------ account export */

export const exportedStorySchema = z.object({
  id: z.uuid(),
  caption: z.string().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type ExportedStory = z.infer<typeof exportedStorySchema>;

export const exportedReportSchema = z.object({
  id: z.uuid(),
  targetType: reportTargetTypeSchema,
  targetId: z.uuid(),
  reason: reportReasonSchema,
  details: z.string().nullable(),
  status: z.enum(['open', 'resolved']),
  createdAt: z.iso.datetime(),
});
export type ExportedReport = z.infer<typeof exportedReportSchema>;
