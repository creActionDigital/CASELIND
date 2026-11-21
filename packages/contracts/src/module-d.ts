import { z } from 'zod';
import { messageSchema } from './messaging.js';
import { miniappPublicSchema } from './miniapps.js';

/* Module D : messages epingles, support CASELIND, favoris des mini-apps. */

export const pinnedMessageListSchema = z.object({ items: z.array(z.object({ message: messageSchema, pinnedAt: z.iso.datetime() })) });
export type PinnedMessageList = z.infer<typeof pinnedMessageListSchema>;
export const MAX_PINNED_MESSAGES = 10;

export const miniappFavoriteListSchema = z.object({ items: z.array(miniappPublicSchema) });
export type MiniAppFavoriteList = z.infer<typeof miniappFavoriteListSchema>;

export const HELP_CATEGORIES = ['account', 'payment', 'order', 'bug', 'other'] as const;
export const helpCategorySchema = z.enum(HELP_CATEGORIES);
export const createHelpRequestRequestSchema = z.object({
  category: helpCategorySchema,
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(2000),
});
export type CreateHelpRequestRequest = z.infer<typeof createHelpRequestRequestSchema>;

export const helpRequestSchema = z.object({
  id: z.uuid(),
  category: helpCategorySchema,
  subject: z.string(),
  body: z.string(),
  status: z.enum(['open', 'resolved']),
  reply: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  /** Administration seulement. */
  userId: z.uuid().optional(),
});
export type HelpRequest = z.infer<typeof helpRequestSchema>;
export const helpRequestListSchema = z.object({ items: z.array(helpRequestSchema) });
export type HelpRequestList = z.infer<typeof helpRequestListSchema>;

export const resolveHelpRequestRequestSchema = z.object({ reply: z.string().trim().min(2).max(2000) });
export type ResolveHelpRequestRequest = z.infer<typeof resolveHelpRequestRequestSchema>;
