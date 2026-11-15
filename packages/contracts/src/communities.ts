import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[\p{L}\p{N}_]{2,30}$/u, 'Tags are 2 to 30 letters, digits or underscores');

/** A group becomes a public community: a short description and up to 5 tags. */
export const publishCommunityRequestSchema = z.object({
  description: z.string().trim().max(500).default(''),
  tags: z
    .array(tagSchema)
    .max(5)
    .default([])
    .transform((t) => [...new Set(t)]),
});
export type PublishCommunityRequest = z.infer<typeof publishCommunityRequestSchema>;

export const communityListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  tag: tagSchema.optional(),
});
export type CommunityListQuery = z.infer<typeof communityListQuerySchema>;

export const communitySchema = z.object({
  conversationId: z.uuid(),
  title: z.string(),
  avatarUrl: z.string().nullable(),
  description: z.string(),
  tags: z.array(z.string()),
  memberCount: z.number().int(),
  /** The viewer is an active member. */
  joined: z.boolean(),
});
export type Community = z.infer<typeof communitySchema>;

export const communityListSchema = z.object({ items: z.array(communitySchema), nextCursor: z.string().nullable() });
export type CommunityList = z.infer<typeof communityListSchema>;

export const trendingTagsSchema = z.object({ items: z.array(z.object({ tag: z.string(), communities: z.number().int() })) });
export type TrendingTags = z.infer<typeof trendingTagsSchema>;
