import { z } from 'zod';
import { sessionSchema } from './auth.js';
import { mediaMimeSchema, mediaPurposeSchema, mediaStatusSchema } from './media.js';
import { orgMemberStatusSchema, orgRoleSchema } from './orgs.js';
import { blockedUserSchema, privacySettingsSchema } from './privacy.js';
import { exportedConversationSchema, exportedMessageSchema } from './messaging.js';
import { exportedCommentSchema, exportedFollowSchema, exportedPostSchema } from './social.js';
import { exportedReportSchema, exportedStorySchema } from './stories.js';
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

/** An organisation membership (or pending invitation) of the user. */
export const exportedOrgMembershipSchema = z.object({
  orgId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  role: orgRoleSchema,
  status: orgMemberStatusSchema,
  joinedAt: z.iso.datetime().nullable(),
});
export type ExportedOrgMembership = z.infer<typeof exportedOrgMembershipSchema>;

/**
 * A file uploaded by the user, in any state. Never the storage key or checksum: only the API
 * content URL (`/v1/media/{id}/content`, ready assets only), which applies the usual access rules.
 */
export const exportedMediaSchema = z.object({
  id: z.uuid(),
  purpose: mediaPurposeSchema,
  /** Detected type; null until the content was received and accepted. */
  mime: mediaMimeSchema.nullable(),
  sizeBytes: z.number().int().nonnegative(),
  status: mediaStatusSchema,
  contentUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ExportedMedia = z.infer<typeof exportedMediaSchema>;

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
  orgMemberships: z.array(exportedOrgMembershipSchema),
  media: z.array(exportedMediaSchema),
  conversations: z.array(exportedConversationSchema),
  /** The 10 000 most recent messages sent by the user, oldest first. */
  messagesSent: z.array(exportedMessageSchema),
  /** True when older messages were left out of `messagesSent`. */
  messagesSentTruncated: z.boolean(),
  /** Lot 4A: the user's (non-deleted) posts and comments, and the accounts they follow. */
  posts: z.array(exportedPostSchema),
  comments: z.array(exportedCommentSchema),
  following: z.array(exportedFollowSchema),
  /** Lot 4B: the user's stories (active and archived) and the reports they filed. */
  stories: z.array(exportedStorySchema),
  reportsFiled: z.array(exportedReportSchema),
});
export type AccountExport = z.infer<typeof accountExportSchema>;

/**
 * 409 details of POST /v1/me/deletion-request when the caller is the last active owner of one or
 * more (non-suspended) organisations: transfer ownership or add another owner first.
 */
export const lastOwnerConflictDetailsSchema = z.object({
  reason: z.literal('last_owner'),
  orgs: z.array(z.object({ id: z.uuid(), slug: z.string(), name: z.string() })),
});
export type LastOwnerConflictDetails = z.infer<typeof lastOwnerConflictDetailsSchema>;

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
