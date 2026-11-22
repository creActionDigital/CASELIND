import { z } from 'zod';
import { orgKindSchema } from './orgs.js';

/**
 * Lot 7 : universal search (C-09). Ranking everywhere: exact match, then prefix, then contains.
 */
export const searchScopeSchema = z.enum(['all', 'users', 'orgs', 'products', 'posts']);
export type SearchScope = z.infer<typeof searchScopeSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  scope: searchScopeSchema.default('all'),
  /** Only with a single scope (with `all` each category returns its 5 best hits). */
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchUserHitSchema = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export const searchOrgHitSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  kind: orgKindSchema,
  logoUrl: z.string().nullable(),
  city: z.string().nullable(),
  verified: z.boolean(),
});
export const searchProductHitSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  coverUrl: z.string().nullable(),
  minPriceMinor: z.number().int(),
  currency: z.string(),
  org: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
});
export const searchPostHitSchema = z.object({
  id: z.uuid(),
  authorId: z.uuid(),
  authorHandle: z.string(),
  authorDisplayName: z.string(),
  snippet: z.string(),
  createdAt: z.iso.datetime(),
});

const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/** Only the searched categories are present. */
export const searchResultSchema = z.object({
  scope: searchScopeSchema,
  users: pageOf(searchUserHitSchema).optional(),
  orgs: pageOf(searchOrgHitSchema).optional(),
  products: pageOf(searchProductHitSchema).optional(),
  posts: pageOf(searchPostHitSchema).optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchUserHit = z.infer<typeof searchUserHitSchema>;
export type SearchOrgHit = z.infer<typeof searchOrgHitSchema>;
export type SearchProductHit = z.infer<typeof searchProductHitSchema>;
export type SearchPostHit = z.infer<typeof searchPostHitSchema>;

export const searchHistoryEntrySchema = z.object({
  id: z.uuid(),
  query: z.string(),
  scope: searchScopeSchema,
  createdAt: z.iso.datetime(),
});
export type SearchHistoryEntry = z.infer<typeof searchHistoryEntrySchema>;

/** GET /v1/me/search-history: newest first, at most 50. */
export const searchHistorySchema = z.object({
  enabled: z.boolean(),
  items: z.array(searchHistoryEntrySchema),
});
export type SearchHistory = z.infer<typeof searchHistorySchema>;

export const searchHistorySettingsSchema = z.object({ enabled: z.boolean() });
export type SearchHistorySettings = z.infer<typeof searchHistorySettingsSchema>;

/** Export of account data (right of access). */
export const exportedSearchHistorySchema = z.object({
  query: z.string(),
  scope: searchScopeSchema,
  createdAt: z.iso.datetime(),
});

/** POST /v1/users/match-contacts : phone-book numbers (E.164, never stored) -> discoverable CASELIND users. */
export const matchContactsRequestSchema = z.object({
  phones: z.array(z.string().regex(/^\+[1-9]\d{7,14}$/)).min(1).max(500),
});
export type MatchContactsRequest = z.infer<typeof matchContactsRequestSchema>;
export const matchContactsResponseSchema = z.object({ items: z.array(searchUserHitSchema) });
export type MatchContactsResponse = z.infer<typeof matchContactsResponseSchema>;
