import { z } from 'zod';
import { HEALTH_CONSENT_VERSION } from './health.js';

/**
 * Privacy consents (G7, CDC §4/§29). The list is a whitelist: adding a kind needs the contract, the
 * `user_consents_kind_check` constraint (forward migration) and its text in the mobile messages.
 */
export const CONSENT_KINDS = ['health', 'marketing', 'location_sharing', 'ai_processing', 'analytics', 'translation'] as const;
export const consentKindSchema = z.enum(CONSENT_KINDS);
export type ConsentKind = z.infer<typeof consentKindSchema>;

/** Version of the text the user accepts for each kind. Bump it when the text changes materially. */
export const CONSENT_VERSIONS: Record<ConsentKind, string> = {
  health: HEALTH_CONSENT_VERSION,
  marketing: '1',
  location_sharing: '1',
  ai_processing: '1',
  analytics: '1',
  translation: '1',
};

/** Current state of one consent. A kind never answered is `granted: false` with no version or date. */
export const userConsentSchema = z.object({
  kind: consentKindSchema,
  granted: z.boolean(),
  version: z.string().nullable(),
  updatedAt: z.iso.datetime().nullable(),
});
export type UserConsent = z.infer<typeof userConsentSchema>;

/** PUT /v1/me/consents/{kind}: grant or withdraw. Idempotent. */
export const setConsentRequestSchema = z.object({ granted: z.boolean() });
export type SetConsentRequest = z.infer<typeof setConsentRequestSchema>;

/** One journal line: a change of answer, never a content. */
export const consentJournalEntrySchema = z.object({
  id: z.uuid(),
  kind: consentKindSchema,
  granted: z.boolean(),
  version: z.string(),
  source: z.string(),
  createdAt: z.iso.datetime(),
});
export type ConsentJournalEntry = z.infer<typeof consentJournalEntrySchema>;

/** GET /v1/me/consents/history: the most recent changes first. */
export const consentHistorySchema = z.object({ items: z.array(consentJournalEntrySchema) });
export type ConsentHistory = z.infer<typeof consentHistorySchema>;
