import { z } from 'zod';
import { conversationKindSchema } from './messaging.js';

/* Search in the text of the caller's messages, and online presence of direct peers. */

export const MESSAGE_SEARCH_Q_MIN = 2;
export const MESSAGE_SEARCH_Q_MAX = 100;

export const messageSearchQuerySchema = z.object({
  q: z.string().trim().min(MESSAGE_SEARCH_Q_MIN).max(MESSAGE_SEARCH_Q_MAX),
  conversationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(300).optional(),
});
export type MessageSearchQuery = z.infer<typeof messageSearchQuerySchema>;

export const messageSearchHitSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  conversationKind: conversationKindSchema,
  /** Group title, or the peer's display name for a direct conversation. */
  conversationTitle: z.string().nullable(),
  seq: z.number().int(),
  /** A short excerpt around the first match. */
  snippet: z.string(),
  senderId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type MessageSearchHit = z.infer<typeof messageSearchHitSchema>;

export const messageSearchResultSchema = z.object({ items: z.array(messageSearchHitSchema), nextCursor: z.string().nullable() });
export type MessageSearchResult = z.infer<typeof messageSearchResultSchema>;

/**
 * `visible` false = hidden (no active direct conversation, blocked, or one of the two hides their presence):
 * then `online` is false and `lastSeenAt` null, whatever the reason. Also the `presence.updated` event payload.
 */
export const presenceSchema = z.object({
  userId: z.uuid(),
  visible: z.boolean(),
  online: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
});
export type Presence = z.infer<typeof presenceSchema>;
