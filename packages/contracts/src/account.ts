import { z } from 'zod';
import { sessionSchema } from './auth.js';
import { blockedUserSchema, privacySettingsSchema } from './privacy.js';
import { meSchema } from './users.js';

/** A session as listed in the data export: every session, including revoked ones. */
export const exportedSessionSchema = sessionSchema.omit({ current: true }).extend({
  revokedAt: z.iso.datetime().nullable(),
});
export type ExportedSession = z.infer<typeof exportedSessionSchema>;

/** An audit event about the user, without internal metadata. */
export const exportedSecurityEventSchema = z.object({
  action: z.string(),
  occurredAt: z.iso.datetime(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type ExportedSecurityEvent = z.infer<typeof exportedSecurityEventSchema>;

/**
 * GET /v1/me/export: everything CASELIND holds about the caller (right of access).
 * Never contains password hashes, token hashes or OTP codes.
 */
export const accountExportSchema = z.object({
  exportedAt: z.iso.datetime(),
  profile: meSchema,
  privacy: privacySettingsSchema,
  sessions: z.array(exportedSessionSchema),
  blocks: z.array(blockedUserSchema),
  securityEvents: z.array(exportedSecurityEventSchema),
});
export type AccountExport = z.infer<typeof accountExportSchema>;

/** POST /v1/me/deletion-request. The current password is required (no format rules: any stored password). */
export const deletionRequestSchema = z.object({
  password: z.string().min(1).max(128),
});
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;

/** 202 answer: the account is anonymised at this date unless the user signs in again before. */
export const deletionRequestResponseSchema = z.object({
  deletionScheduledFor: z.iso.datetime(),
});
export type DeletionRequestResponse = z.infer<typeof deletionRequestResponseSchema>;
