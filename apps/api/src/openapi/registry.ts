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
  { method: 'post', path: '/v1/me/deletion-request', summary: 'Schedule account deletion (password required); signing in again cancels it', tags: ['account'], auth: 'user', body: deletionRequestSchema, response: deletionRequestResponseSchema, status: 202 },

  // Admin
  { method: 'get', path: '/v1/admin/audit-events', summary: 'Audit log, newest first (pass the last id as `before` for the next page)', tags: ['admin'], auth: 'admin', query: auditQuerySchema, response: auditEventPageSchema, status: 200 },
];
