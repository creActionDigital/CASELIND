import {
  accountExportSchema,
  blockListQuerySchema,
  blockListSchema,
  challengeResponseSchema,
  deletionRequestResponseSchema,
  deletionRequestSchema,
  featureFlagSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  meSchema,
  privacySettingsSchema,
  publicProfileSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resendOtpRequestSchema,
  resetPasswordRequestSchema,
  securityEventSchema,
  sessionSchema,
  tokenPairSchema,
  updateFeatureFlagRequestSchema,
  updateMeRequestSchema,
  updatePrivacyRequestSchema,
  userFlagsSchema,
  verifyOtpRequestSchema,
} from '@caselind/contracts';
import { z } from 'zod';
import { auditQuerySchema } from '../admin/admin.controller.js';
// Lot 2a (organisations), kept as a separate import to limit merge conflicts with parallel lots.
import {
  createOrgRequestSchema,
  inviteOrgMemberRequestSchema,
  myOrgMembershipListSchema,
  myOrgMembershipSchema,
  orgMemberListQuerySchema,
  orgMemberListSchema,
  orgMemberSchema,
  orgSchema,
  publicOrgSchema,
  updateOrgMemberRequestSchema,
  updateOrgRequestSchema,
} from '@caselind/contracts';
// Lot 2b (media), separate import for the same reason.
import {
  createUploadRequestSchema,
  createUploadResponseSchema,
  mediaAssetPublicSchema,
  mediaAssetSchema,
  mediaMimeSchema,
  setAvatarRequestSchema,
} from '@caselind/contracts';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
/** public: no token; user: any authenticated account; admin: requires the `admin` platform role. */
export type AuthLevel = 'public' | 'user' | 'admin';

export interface ApiOperation {
  method: HttpMethod;
  /** OpenAPI form, including the global prefix: `/v1/blocks/{userId}`. */
  path: string;
  summary: string;
  tags: string[];
  auth: AuthLevel;
  /** Path parameter schemas, keyed by name. Parameters not listed here default to a plain string. */
  params?: Record<string, z.ZodType>;
  body?: z.ZodType;
  /** Must be a z.object: each property becomes a query parameter. */
  query?: z.ZodObject;
  /** Omitted for responses without a body (204). */
  response?: z.ZodType;
  status: number;
  /** Required request headers (besides Authorization), keyed by header name. */
  headers?: Record<string, z.ZodType>;
  /** Binary request body (raw bytes, not JSON) accepted under these content types; exclusive with `body`. */
  rawBody?: readonly string[];
  /** Binary response body served under these content types; exclusive with `response`. */
  rawResponse?: readonly string[];
}

/* Response shapes that exist only in the API (no contract in @caselind/contracts). */

const healthResponseSchema = z.object({ status: z.literal('ok'), db: z.literal('ok') });

/** Row of `audit_events` as returned to admins (bigint id serialised as a string). */
const auditEventSchema = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  action: z.string(),
  actorUserId: z.uuid().nullable(),
  subjectUserId: z.uuid().nullable(),
  sessionId: z.uuid().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
const auditEventPageSchema = z.object({ items: z.array(auditEventSchema), nextCursor: z.string().nullable() });

const itemsOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/** The OpenAPI document itself is an arbitrary JSON object. */
const openApiDocumentSchema = z.object({ openapi: z.string() }).loose();

/**
 * Every route mounted by the API. test/openapi.e2e.test.ts checks this list against the routes
 * Express actually serves, both ways: adding a controller route without registering it here fails CI.
 */
export const apiOperations: readonly ApiOperation[] = [
  // Platform
  { method: 'get', path: '/v1/health', summary: 'Liveness and database reachability', tags: ['platform'], auth: 'public', response: healthResponseSchema, status: 200 },
  { method: 'get', path: '/v1/openapi.json', summary: 'This OpenAPI 3.1 document', tags: ['platform'], auth: 'public', response: openApiDocumentSchema, status: 200 },

  // Auth
  { method: 'post', path: '/v1/auth/register', summary: 'Create an account and send a verification code (same answer whether or not the identifier exists)', tags: ['auth'], auth: 'public', body: registerRequestSchema, response: challengeResponseSchema, status: 202 },
  { method: 'post', path: '/v1/auth/otp/verify', summary: 'Verify the sign-up code and open a session', tags: ['auth'], auth: 'public', body: verifyOtpRequestSchema, response: tokenPairSchema, status: 200 },
  { method: 'post', path: '/v1/auth/otp/resend', summary: 'Resend the code of a pending challenge', tags: ['auth'], auth: 'public', body: resendOtpRequestSchema, response: challengeResponseSchema, status: 202 },
  { method: 'post', path: '/v1/auth/login', summary: 'Sign in with identifier and password', tags: ['auth'], auth: 'public', body: loginRequestSchema, response: tokenPairSchema, status: 200 },
  { method: 'post', path: '/v1/auth/refresh', summary: 'Rotate the refresh token and get a new token pair', tags: ['auth'], auth: 'public', body: refreshRequestSchema, response: tokenPairSchema, status: 200 },
  { method: 'post', path: '/v1/auth/logout', summary: 'Revoke the current session', tags: ['auth'], auth: 'user', status: 204 },
  { method: 'get', path: '/v1/auth/sessions', summary: "List the caller's active sessions", tags: ['auth'], auth: 'user', response: itemsOf(sessionSchema), status: 200 },
  { method: 'delete', path: '/v1/auth/sessions/{id}', summary: 'Revoke one of the caller\'s sessions', tags: ['auth'], auth: 'user', params: { id: z.uuid() }, status: 204 },
  { method: 'post', path: '/v1/auth/password/forgot', summary: 'Send a password reset code (same answer whether or not the identifier exists)', tags: ['auth'], auth: 'public', body: forgotPasswordRequestSchema, response: challengeResponseSchema, status: 202 },
  { method: 'post', path: '/v1/auth/password/reset', summary: 'Set a new password with a reset code; revokes every session', tags: ['auth'], auth: 'public', body: resetPasswordRequestSchema, status: 204 },

  // Users
  { method: 'get', path: '/v1/me', summary: "The caller's account", tags: ['users'], auth: 'user', response: meSchema, status: 200 },
  { method: 'patch', path: '/v1/me', summary: "Update the caller's profile", tags: ['users'], auth: 'user', body: updateMeRequestSchema, response: meSchema, status: 200 },
  { method: 'get', path: '/v1/me/security-events', summary: "Recent security events on the caller's account", tags: ['users'], auth: 'user', response: itemsOf(securityEventSchema), status: 200 },
  { method: 'get', path: '/v1/users/{handle}', summary: 'Public profile by handle (404 when blocked either way)', tags: ['users'], auth: 'user', params: { handle: z.string() }, response: publicProfileSchema, status: 200 },

  // Feature flags
  { method: 'get', path: '/v1/config/flags', summary: 'Feature flags evaluated for the caller (country and roles)', tags: ['flags'], auth: 'user', response: userFlagsSchema, status: 200 },
  { method: 'get', path: '/v1/admin/flags', summary: 'List every feature flag definition', tags: ['admin', 'flags'], auth: 'admin', response: itemsOf(featureFlagSchema), status: 200 },
  { method: 'put', path: '/v1/admin/flags/{key}', summary: 'Update a feature flag (regulated flags need confirmRegulated); audited', tags: ['admin', 'flags'], auth: 'admin', params: { key: z.string() }, body: updateFeatureFlagRequestSchema, response: featureFlagSchema, status: 200 },

  // Privacy and blocks
  { method: 'get', path: '/v1/me/privacy', summary: "The caller's privacy settings", tags: ['privacy'], auth: 'user', response: privacySettingsSchema, status: 200 },
  { method: 'patch', path: '/v1/me/privacy', summary: "Update the caller's privacy settings", tags: ['privacy'], auth: 'user', body: updatePrivacyRequestSchema, response: privacySettingsSchema, status: 200 },
  { method: 'get', path: '/v1/blocks', summary: 'Users the caller has blocked, newest first (cursor pagination)', tags: ['privacy'], auth: 'user', query: blockListQuerySchema, response: blockListSchema, status: 200 },
  { method: 'put', path: '/v1/blocks/{userId}', summary: 'Block a user (idempotent; unknown or malformed id is 404)', tags: ['privacy'], auth: 'user', params: { userId: z.string() }, status: 204 },
  { method: 'delete', path: '/v1/blocks/{userId}', summary: 'Unblock a user (idempotent)', tags: ['privacy'], auth: 'user', params: { userId: z.string() }, status: 204 },

  // Account (data rights)
  { method: 'get', path: '/v1/me/export', summary: 'Export everything held about the caller (right of access); audited', tags: ['account'], auth: 'user', response: accountExportSchema, status: 200 },
  { method: 'post', path: '/v1/me/deletion-request', summary: 'Schedule account deletion (password required; last active owner of an organisation: 409 last_owner); signing in again cancels it', tags: ['account'], auth: 'user', body: deletionRequestSchema, response: deletionRequestResponseSchema, status: 202 },

  // Admin
  { method: 'get', path: '/v1/admin/audit-events', summary: 'Audit log, newest first (pass the last id as `before` for the next page)', tags: ['admin'], auth: 'admin', query: auditQuerySchema, response: auditEventPageSchema, status: 200 },

  // Organisations (lot 2a). `{orgId}` routes: non-member or malformed id → 404, role without the permission → 403.
  { method: 'post', path: '/v1/orgs', summary: 'Create an organisation; the caller becomes its owner (slug taken or owner quota reached: 409)', tags: ['orgs'], auth: 'user', body: createOrgRequestSchema, response: orgSchema, status: 201 },
  { method: 'get', path: '/v1/orgs/{orgId}', summary: 'Full organisation (active members only)', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, response: orgSchema, status: 200 },
  { method: 'patch', path: '/v1/orgs/{orgId}', summary: 'Update the organisation profile (org.profile.edit); audited', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, body: updateOrgRequestSchema, response: orgSchema, status: 200 },
  { method: 'get', path: '/v1/orgs/{orgId}/members', summary: 'Members and pending invitations, oldest first (org.members.view; cursor pagination)', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, query: orgMemberListQuerySchema, response: orgMemberListSchema, status: 200 },
  { method: 'post', path: '/v1/orgs/{orgId}/invitations', summary: 'Invite a user by handle (org.members.manage; owner/admin roles need org.admins.manage)', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, body: inviteOrgMemberRequestSchema, response: orgMemberSchema, status: 201 },
  { method: 'patch', path: '/v1/orgs/{orgId}/members/{userId}', summary: "Change a member's role (last active owner cannot be demoted: 409)", tags: ['orgs'], auth: 'user', params: { orgId: z.string(), userId: z.string() }, body: updateOrgMemberRequestSchema, response: orgMemberSchema, status: 200 },
  { method: 'delete', path: '/v1/orgs/{orgId}/members/{userId}', summary: 'Remove a member, cancel an invitation, or leave (own id); last active owner: 409', tags: ['orgs'], auth: 'user', params: { orgId: z.string(), userId: z.string() }, status: 204 },
  { method: 'get', path: '/v1/me/orgs', summary: "The caller's organisation memberships and pending invitations", tags: ['orgs'], auth: 'user', response: myOrgMembershipListSchema, status: 200 },
  { method: 'post', path: '/v1/me/org-invitations/{orgId}/accept', summary: 'Accept a pending invitation', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, response: myOrgMembershipSchema, status: 200 },
  { method: 'post', path: '/v1/me/org-invitations/{orgId}/decline', summary: 'Decline a pending invitation', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, status: 204 },
  { method: 'get', path: '/v1/public/orgs/{slug}', summary: 'Public storefront page (public and active organisations only; no token needed)', tags: ['orgs'], auth: 'public', params: { slug: z.string() }, response: publicOrgSchema, status: 200 },

  // Media (lot 2b)
  { method: 'post', path: '/v1/media/uploads', summary: 'Announce an upload: purpose, declared type and size (limit per kind: 400; per-user quota of unfinished uploads and bytes: 409 quota_exceeded); returns a 15-minute upload token', tags: ['media'], auth: 'user', body: createUploadRequestSchema, response: createUploadResponseSchema, status: 201 },
  { method: 'post', path: '/v1/media/uploads/{id}/token', summary: 'Re-issue a 15-minute upload token for a pending upload of the caller (404 not theirs, 409 no longer pending)', tags: ['media'], auth: 'user', params: { id: z.uuid() }, response: createUploadResponseSchema, status: 200 },
  { method: 'put', path: '/v1/media/uploads/{id}/content', summary: 'Send the raw bytes of a pending upload (owner + X-Upload-Token; bad token 403, done 409, larger than announced or than the limit 413, type refused or mismatched 415)', tags: ['media'], auth: 'user', params: { id: z.uuid() }, headers: { 'X-Upload-Token': z.string() }, rawBody: ['application/octet-stream', ...mediaMimeSchema.options], response: mediaAssetSchema, status: 200 },
  { method: 'get', path: '/v1/media/{id}', summary: 'Media metadata (owner: full view, any state; others: reduced view of ready assets they may read, 404 otherwise)', tags: ['media'], auth: 'user', params: { id: z.uuid() }, response: z.union([mediaAssetSchema, mediaAssetPublicSchema]), status: 200 },
  { method: 'get', path: '/v1/media/{id}/content', summary: 'Media bytes with the detected Content-Type (nosniff; PDF as attachment)', tags: ['media'], auth: 'user', params: { id: z.uuid() }, rawResponse: mediaMimeSchema.options, status: 200 },
  { method: 'delete', path: '/v1/media/{id}', summary: "Delete one of the caller's media and its file (clears the avatar using it); audited", tags: ['media'], auth: 'user', params: { id: z.uuid() }, status: 204 },
  { method: 'patch', path: '/v1/me/avatar', summary: 'Set the avatar to a ready `avatar` upload of the caller, or remove it with null; audited', tags: ['media', 'users'], auth: 'user', body: setAvatarRequestSchema, response: meSchema, status: 200 },
];
