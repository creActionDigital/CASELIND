import { z } from 'zod';
import { MESSAGE_BODY_MAX, messageSchema } from './messaging.js';

/* Lot 3b: forwarding, message favourites, scheduled messages, drafts. */

export const SCHEDULE_MIN_SECONDS = 60;
export const SCHEDULE_MAX_SECONDS = 30 * 86400;
export const DISAPPEARING_CHOICES = [86400, 604800, 7776000] as const;

export const forwardMessageRequestSchema = z.object({
  conversationIds: z.array(z.uuid()).min(1).max(10),
  clientId: z.uuid(),
});
export type ForwardMessageRequest = z.infer<typeof forwardMessageRequestSchema>;

/** `not_found` = unknown or not a member; `not_allowed` = blocked, peer gone or any other send rule. */
export const forwardResultSchema = z.object({
  conversationId: z.uuid(),
  status: z.enum(['sent', 'error']),
  message: messageSchema.nullable(),
  code: z.enum(['not_found', 'not_allowed']).nullable(),
});
export type ForwardResult = z.infer<typeof forwardResultSchema>;
export const forwardMessageResponseSchema = z.object({ results: z.array(forwardResultSchema) });
export type ForwardMessageResponse = z.infer<typeof forwardMessageResponseSchema>;

export const favoriteMessageSchema = z.object({ message: messageSchema, favoritedAt: z.iso.datetime() });
export type FavoriteMessage = z.infer<typeof favoriteMessageSchema>;
export const favoriteListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(300).optional(),
});
export type FavoriteListQuery = z.infer<typeof favoriteListQuerySchema>;
export const favoriteListSchema = z.object({ items: z.array(favoriteMessageSchema), nextCursor: z.string().nullable() });
export type FavoriteList = z.infer<typeof favoriteListSchema>;

export const scheduledMessageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  clientId: z.uuid(),
  kind: z.enum(['text', 'media']),
  body: z.string().nullable(),
  mediaId: z.uuid().nullable(),
  replyToId: z.uuid().nullable(),
  mentions: z.array(z.uuid()),
  scheduledAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type ScheduledMessage = z.infer<typeof scheduledMessageSchema>;
export const scheduledMessageListSchema = z.object({ items: z.array(scheduledMessageSchema) });
export type ScheduledMessageList = z.infer<typeof scheduledMessageListSchema>;

export const draftRequestSchema = z.object({ body: z.string().min(1).max(MESSAGE_BODY_MAX) });
export type DraftRequest = z.infer<typeof draftRequestSchema>;
export const draftSchema = z.object({ conversationId: z.uuid(), body: z.string(), updatedAt: z.iso.datetime() });
export type Draft = z.infer<typeof draftSchema>;

export const exportedFavoriteMessageSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  body: z.string().nullable(),
  favoritedAt: z.iso.datetime(),
});
