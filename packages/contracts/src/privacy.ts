import { z } from 'zod';
import { type Page, pageQuerySchema } from './pagination.js';

/** Who may send the user a contact request. */
export const contactRequestsFromSchema = z.enum(['everyone', 'contacts_of_contacts', 'nobody']);
export type ContactRequestsFrom = z.infer<typeof contactRequestsFromSchema>;

/** Privacy settings. Discoverability by phone/e-mail is opt-in (off by default). */
export const privacySettingsSchema = z.object({
  discoverableByPhone: z.boolean(),
  discoverableByEmail: z.boolean(),
  contactRequestsFrom: contactRequestsFromSchema,
  readReceipts: z.boolean(),
  /** Online / last seen shown to direct peers; reciprocal (hiding yours hides theirs from you). */
  showPresence: z.boolean(),
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export const updatePrivacyRequestSchema = privacySettingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'at least one field is required');
export type UpdatePrivacyRequest = z.infer<typeof updatePrivacyRequestSchema>;

/** A user the caller has blocked. */
export const blockedUserSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  blockedAt: z.iso.datetime(),
});
export type BlockedUser = z.infer<typeof blockedUserSchema>;

/** GET /blocks: newest first, cursor pagination (default 50, max 200 per page). */
export const blockListQuerySchema = pageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type BlockListQuery = z.infer<typeof blockListQuerySchema>;

export const blockListSchema = z.object({ items: z.array(blockedUserSchema), nextCursor: z.string().nullable() });
export type BlockList = Page<BlockedUser>;
