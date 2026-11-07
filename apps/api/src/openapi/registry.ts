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
// Lot 3B (notifications), separate import for the same reason.
import {
  notificationListQuerySchema,
  notificationListSchema,
  notificationPreferencesSchema,
  registerPushTokenRequestSchema,
  unreadCountSchema,
  unregisterPushTokenRequestSchema,
  updateNotificationPreferencesRequestSchema,
} from '@caselind/contracts';

// Lot 3A (messaging), separate import for the same reason.
import {
  addConversationMembersRequestSchema,
  conversationListQuerySchema,
  conversationListSchema,
  conversationMemberListSchema,
  conversationMemberSchema,
  conversationSchema,
  createConversationRequestSchema,
  messageListQuerySchema,
  messageListSchema,
  messageSchema,
  reactionRequestSchema,
  receiptRequestSchema,
  receiptStateSchema,
  recallQuerySchema,
  sendMessageRequestSchema,
  updateConversationMemberRequestSchema,
  updateConversationRequestSchema,
  updateMyConversationStateRequestSchema,
} from '@caselind/contracts';

// Lot 3b (forward, favourites, scheduled messages, drafts), separate import block.
import {
  draftRequestSchema,
  draftSchema,
  favoriteListQuerySchema,
  favoriteListSchema,
  forwardMessageRequestSchema,
  forwardMessageResponseSchema,
  scheduledMessageListSchema,
  scheduledMessageSchema,
} from '@caselind/contracts';

// Lot 4B (stories, reports, moderation), separate import block to limit merge conflicts.
import {
  createReportRequestSchema,
  createStoryRequestSchema,
  moderationActionRequestSchema,
  moderationActionResultSchema,
  moderationReportGroupPageSchema,
  moderationReportsQuerySchema,
  pageQuerySchema,
  reportPageSchema,
  reportSchema,
  storyFeedSchema,
  storyListSchema,
  storyPageQuerySchema,
  storyPageSchema,
  storySchema,
  storyViewerListSchema,
} from '@caselind/contracts';

// Lot 5B (cart, orders, coupons, reviews), separate import block.
import {
  cancelOrderRequestSchema,
  cartSchema,
  checkoutRequestSchema,
  checkoutResponseSchema,
  couponListQuerySchema,
  couponListSchema,
  couponSchema,
  createCouponRequestSchema,
  createReviewRequestSchema,
  orderDetailSchema,
  orderListQuerySchema,
  orderListSchema,
  orgReviewListQuerySchema,
  orgReviewListSchema,
  paymentMethodListSchema,
  reviewListQuerySchema,
  reviewListSchema,
  reviewReplyRequestSchema,
  reviewSchema,
  setCartItemRequestSchema,
  updateCouponRequestSchema,
  updateOrderStatusRequestSchema,
  updateReviewRequestSchema,
} from '@caselind/contracts';
// Lot 7 (places, universal search), separate import block.
import {
  placeListSchema,
  placesQuerySchema,
  orgLocationSchema,
  searchHistorySchema,
  searchHistorySettingsSchema,
  searchQuerySchema,
  searchResultSchema,
  setOrgLocationRequestSchema,
  updateOrgLocationRequestSchema,
} from '@caselind/contracts';
// Lot 6B (KYC, payment PIN, merchant QR), separate import block.
import {
  adminKycListQuerySchema,
  adminKycListSchema,
  adminKycSubmissionSchema,
  createdPaymentQrSchema,
  createKycSubmissionRequestSchema,
  createPaymentQrRequestSchema,
  kycDecisionRequestSchema,
  kycStatusViewSchema,
  kycSubmissionSchema,
  payQrRequestSchema,
  payQrResponseSchema,
  paymentQrListSchema,
  qrPayloadSchema,
  resolvedPaymentQrSchema,
  setPaymentPinRequestSchema,
} from '@caselind/contracts';
// Lot 6A (ledger, sandbox wallet), separate import block.
import {
  adminLedgerAccountSchema,
  ledgerReconciliationSchema,
  orgWalletSchema,
  sandboxTopupRequestSchema,
  walletSchema,
  walletTransactionListSchema,
  walletTransactionsQuerySchema,
  walletTransferRequestSchema,
  walletTransferResponseSchema,
} from '@caselind/contracts';
// Lot 1c (2FA, identifier change, QR login), separate import block.
import {
  identifierChangeRequestSchema,
  identifierChangeVerifySchema,
  loginResponseSchema,
  qrApproveRequestSchema,
  qrApproveResponseSchema,
  qrSessionRequestSchema,
  qrSessionResponseSchema,
  qrSessionStatusSchema,
  totpDisableRequestSchema,
  totpEnableRequestSchema,
  totpEnableResponseSchema,
  totpSetupResponseSchema,
  twoFactorVerifyRequestSchema,
} from '@caselind/contracts';
// Lot 4A (social), separate import block.
// Lot 5A (catalogue), separate import block.
import {
  adjustStockRequestSchema,
  createProductRequestSchema,
  orgProductListQuerySchema,
  orgStorefrontQuerySchema,
  productCategoryListSchema,
  productListSchema,
  productSchema,
  storefrontProductDetailSchema,
  storefrontProductListSchema,
  storefrontQuerySchema,
  updateProductRequestSchema,
  variantSchema,
} from '@caselind/contracts';

import {
  commentListSchema,
  commentSchema,
  createCommentRequestSchema,
  createPostRequestSchema,
  postListSchema,
  postSchema,
  setReactionRequestSchema,
  socialPageQuerySchema,
  socialStatsSchema,
  socialUserListSchema,
  updatePostRequestSchema,
} from '@caselind/contracts';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
/** public: no token; user: any authenticated account; admin: the `admin` platform role; moderator: the `admin` or `moderator` platform role. */
export type AuthLevel = 'public' | 'user' | 'admin' | 'moderator';

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
  { method: 'post', path: '/v1/auth/login', summary: 'Sign in with identifier and password; with 2FA answers 200 {twoFactorRequired, challengeId} and no token', tags: ['auth'], auth: 'public', body: loginRequestSchema, response: loginResponseSchema, status: 200 },
  { method: 'post', path: '/v1/auth/refresh', summary: 'Rotate the refresh token and get a new token pair', tags: ['auth'], auth: 'public', body: refreshRequestSchema, response: tokenPairSchema, status: 200 },
  { method: 'post', path: '/v1/auth/logout', summary: 'Revoke the current session', tags: ['auth'], auth: 'user', status: 204 },
  { method: 'get', path: '/v1/auth/sessions', summary: "List the caller's active sessions", tags: ['auth'], auth: 'user', response: itemsOf(sessionSchema), status: 200 },
  { method: 'delete', path: '/v1/auth/sessions/{id}', summary: 'Revoke one of the caller\'s sessions', tags: ['auth'], auth: 'user', params: { id: z.uuid() }, status: 204 },
  { method: 'post', path: '/v1/auth/password/forgot', summary: 'Send a password reset code (same answer whether or not the identifier exists)', tags: ['auth'], auth: 'public', body: forgotPasswordRequestSchema, response: challengeResponseSchema, status: 202 },
  { method: 'post', path: '/v1/auth/password/reset', summary: 'Set a new password with a reset code; revokes every session', tags: ['auth'], auth: 'public', body: resetPasswordRequestSchema, status: 204 },

  // Lot 1c: TOTP 2FA, identifier change, QR web login. No secret, code or QR payload is ever logged or audited.
  { method: 'post', path: '/v1/auth/2fa/verify', summary: 'Second step of a 2FA login (TOTP or single-use backup code); challenge valid 5 min, 5 attempts', tags: ['auth'], auth: 'public', body: twoFactorVerifyRequestSchema, response: tokenPairSchema, status: 200 },
  { method: 'post', path: '/v1/me/2fa/totp/setup', summary: 'Start TOTP enrolment: base32 secret and otpauth:// URI (inactive until enable)', tags: ['auth'], auth: 'user', response: totpSetupResponseSchema, status: 200 },
  { method: 'post', path: '/v1/me/2fa/totp/enable', summary: 'Activate 2FA with a code and the password; returns 10 single-use backup codes once', tags: ['auth'], auth: 'user', body: totpEnableRequestSchema, response: totpEnableResponseSchema, status: 200 },
  { method: 'post', path: '/v1/me/2fa/totp/disable', summary: 'Deactivate 2FA (password and TOTP code or backup code)', tags: ['auth'], auth: 'user', body: totpDisableRequestSchema, status: 204 },
  { method: 'post', path: '/v1/me/identifier-change', summary: 'Request a phone/e-mail change: sends a code to the NEW identifier (same answer if it is taken)', tags: ['users'], auth: 'user', body: identifierChangeRequestSchema, response: challengeResponseSchema, status: 202 },
  { method: 'post', path: '/v1/me/identifier-change/verify', summary: 'Confirm the change (409 if the identifier is taken); revokes the other sessions and warns the old e-mail', tags: ['users'], auth: 'user', body: identifierChangeVerifySchema, status: 204 },
  { method: 'post', path: '/v1/auth/qr/session', summary: 'Create a web QR login session (2 min); returns the QR payload and the polling secret', tags: ['auth'], auth: 'public', body: qrSessionRequestSchema, response: qrSessionResponseSchema, status: 201 },
  { method: 'post', path: '/v1/auth/qr/approve', summary: 'From a signed-in device: preview the requesting device, then approve with confirm=true', tags: ['auth'], auth: 'user', body: qrApproveRequestSchema, response: qrApproveResponseSchema, status: 200 },
  { method: 'get', path: '/v1/auth/qr/session/{id}', summary: 'Poll a QR session (header X-QR-Session-Secret); the TokenPair is delivered once on approval', tags: ['auth'], auth: 'public', params: { id: z.uuid() }, headers: { 'x-qr-session-secret': z.string() }, response: qrSessionStatusSchema, status: 200 },

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
  { method: 'put', path: '/v1/me/push-tokens', summary: 'Register (or re-attach) an Expo push token to the current session; idempotent', tags: ['notifications'], auth: 'user', body: registerPushTokenRequestSchema, status: 204 },
  { method: 'post', path: '/v1/me/push-tokens/unregister', summary: "Remove one of the caller's push tokens", tags: ['notifications'], auth: 'user', body: unregisterPushTokenRequestSchema, status: 204 },
  { method: 'get', path: '/v1/notifications', summary: 'Notification centre, newest first (cursor pagination)', tags: ['notifications'], auth: 'user', query: notificationListQuerySchema, response: notificationListSchema, status: 200 },
  { method: 'get', path: '/v1/notifications/unread-count', summary: 'Number of unread notifications', tags: ['notifications'], auth: 'user', response: unreadCountSchema, status: 200 },
  { method: 'post', path: '/v1/notifications/read-all', summary: 'Mark every notification as read', tags: ['notifications'], auth: 'user', status: 204 },
  { method: 'post', path: '/v1/notifications/{id}/read', summary: 'Mark one notification as read (idempotent; a notification of another user or an unknown id is 404)', tags: ['notifications'], auth: 'user', params: { id: z.string() }, status: 204 },
  { method: 'get', path: '/v1/me/notification-preferences', summary: "The caller's notification preferences", tags: ['notifications'], auth: 'user', response: notificationPreferencesSchema, status: 200 },
  { method: 'patch', path: '/v1/me/notification-preferences', summary: "Update the caller's notification preferences (security cannot be disabled)", tags: ['notifications'], auth: 'user', body: updateNotificationPreferencesRequestSchema, response: notificationPreferencesSchema, status: 200 },
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
  { method: 'patch', path: '/v1/orgs/{orgId}', summary: 'Update the organisation profile (org.profile.edit; supportUserId = active member buyers are pointed to, null = oldest active owner); audited', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, body: updateOrgRequestSchema, response: orgSchema, status: 200 },
  { method: 'get', path: '/v1/orgs/{orgId}/members', summary: 'Members and pending invitations, oldest first (org.members.view; cursor pagination)', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, query: orgMemberListQuerySchema, response: orgMemberListSchema, status: 200 },
  { method: 'post', path: '/v1/orgs/{orgId}/invitations', summary: 'Invite a user by handle (org.members.manage; owner/admin roles need org.admins.manage)', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, body: inviteOrgMemberRequestSchema, response: orgMemberSchema, status: 201 },
  { method: 'patch', path: '/v1/orgs/{orgId}/members/{userId}', summary: "Change a member's role (last active owner cannot be demoted: 409)", tags: ['orgs'], auth: 'user', params: { orgId: z.string(), userId: z.string() }, body: updateOrgMemberRequestSchema, response: orgMemberSchema, status: 200 },
  { method: 'delete', path: '/v1/orgs/{orgId}/members/{userId}', summary: 'Remove a member, cancel an invitation, or leave (own id); last active owner: 409', tags: ['orgs'], auth: 'user', params: { orgId: z.string(), userId: z.string() }, status: 204 },
  { method: 'get', path: '/v1/me/orgs', summary: "The caller's organisation memberships and pending invitations", tags: ['orgs'], auth: 'user', response: myOrgMembershipListSchema, status: 200 },
  { method: 'post', path: '/v1/me/org-invitations/{orgId}/accept', summary: 'Accept a pending invitation', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, response: myOrgMembershipSchema, status: 200 },
  { method: 'post', path: '/v1/me/org-invitations/{orgId}/decline', summary: 'Decline a pending invitation', tags: ['orgs'], auth: 'user', params: { orgId: z.string() }, status: 204 },
  { method: 'get', path: '/v1/public/orgs/{slug}', summary: 'Public storefront page (public and active organisations only; no token needed; contactUserId = support member, null if blocked with the caller when a token is sent)', tags: ['orgs'], auth: 'public', params: { slug: z.string() }, response: publicOrgSchema, status: 200 },

  // Media (lot 2b)
  { method: 'post', path: '/v1/media/uploads', summary: 'Announce an upload: purpose, declared type and size (limit per kind: 400; per-user quota of unfinished uploads and bytes: 409 quota_exceeded); returns a 15-minute upload token', tags: ['media'], auth: 'user', body: createUploadRequestSchema, response: createUploadResponseSchema, status: 201 },
  { method: 'post', path: '/v1/media/uploads/{id}/token', summary: 'Re-issue a 15-minute upload token for a pending upload of the caller (404 not theirs, 409 no longer pending)', tags: ['media'], auth: 'user', params: { id: z.uuid() }, response: createUploadResponseSchema, status: 200 },
  { method: 'put', path: '/v1/media/uploads/{id}/content', summary: 'Send the raw bytes of a pending upload (owner + X-Upload-Token; bad token 403, done 409, larger than announced or than the limit 413, type refused or mismatched 415)', tags: ['media'], auth: 'user', params: { id: z.uuid() }, headers: { 'X-Upload-Token': z.string() }, rawBody: ['application/octet-stream', ...mediaMimeSchema.options], response: mediaAssetSchema, status: 200 },
  { method: 'get', path: '/v1/media/{id}', summary: 'Media metadata (owner: full view, any state; others: reduced view of ready assets they may read, 404 otherwise)', tags: ['media'], auth: 'user', params: { id: z.uuid() }, response: z.union([mediaAssetSchema, mediaAssetPublicSchema]), status: 200 },
  { method: 'get', path: '/v1/media/{id}/content', summary: 'Media bytes with the detected Content-Type (nosniff; PDF as attachment)', tags: ['media'], auth: 'user', params: { id: z.uuid() }, rawResponse: mediaMimeSchema.options, status: 200 },
  { method: 'get', path: '/v1/public/media/{id}/content', summary: 'Anonymous storefront image: bytes of a ready "product" image attached to a published, non-hidden product of an active public org (anything else: 404); public cache 5 min, nosniff, sandbox CSP', tags: ['media', 'catalog'], auth: 'public', params: { id: z.uuid() }, rawResponse: mediaMimeSchema.options, status: 200 },
  { method: 'delete', path: '/v1/media/{id}', summary: "Delete one of the caller's media and its file (clears the avatar using it); audited", tags: ['media'], auth: 'user', params: { id: z.uuid() }, status: 204 },
  { method: 'patch', path: '/v1/me/avatar', summary: 'Set the avatar to a ready `avatar` upload of the caller, or remove it with null; audited', tags: ['media', 'users'], auth: 'user', body: setAvatarRequestSchema, response: meSchema, status: 200 },
  // Messaging (lot 3A). Non-member or malformed id: 404. Blocked pair: 403 (direct) or 404 (group add).
  { method: 'post', path: '/v1/conversations', summary: 'Create a group, or open the direct conversation with a user (201; 200 when it already exists). Blocked: 403; target refuses contact requests: 403 details.reason contact_requests_restricted; group too large: 409', tags: ['messaging'], auth: 'user', body: createConversationRequestSchema, response: conversationSchema, status: 201 },
  { method: 'get', path: '/v1/conversations', summary: 'The conversations of the caller: pinned first, then by last activity (?archived=true for archived ones; cursor pagination)', tags: ['messaging'], auth: 'user', query: conversationListQuerySchema, response: conversationListSchema, status: 200 },
  { method: 'get', path: '/v1/conversations/{id}', summary: 'One conversation as seen by the caller (unread count, last message, mute/pin/archive)', tags: ['messaging'], auth: 'user', params: { id: z.string() }, response: conversationSchema, status: 200 },
  { method: 'patch', path: '/v1/conversations/{id}', summary: 'Edit a group: title, announcement, avatar (admin or owner); a title change adds a system message. disappearingSeconds (null, 86400, 604800 or 7776000; admin or owner in a group, either participant in a direct) sets the lifetime of new messages and adds a system message', tags: ['messaging'], auth: 'user', params: { id: z.string() }, body: updateConversationRequestSchema, response: conversationSchema, status: 200 },
  { method: 'patch', path: '/v1/conversations/{id}/me', summary: 'Own state of the caller in the conversation: mutedUntil, pinned, archived', tags: ['messaging'], auth: 'user', params: { id: z.string() }, body: updateMyConversationStateRequestSchema, response: conversationSchema, status: 200 },
  { method: 'get', path: '/v1/conversations/{id}/messages', summary: 'Messages, most recent first (beforeSeq, limit up to 100); only those after the caller joined and not hidden for them', tags: ['messaging'], auth: 'user', params: { id: z.string() }, query: messageListQuerySchema, response: messageListSchema, status: 200 },
  { method: 'post', path: '/v1/conversations/{id}/messages', summary: 'Send a text or media message; idempotent per clientId (201 new, 200 replay). Blocked direct: 403; foreign or wrong-purpose media, bad reply or mention: 400. With scheduledAt (1 minute to 30 days ahead) the message is only scheduled: 202 with a ScheduledMessage (200 replay), no seq until the minute job sends it (rules re-checked then; cancelled and the author notified if they no longer hold)', tags: ['messaging'], auth: 'user', params: { id: z.string() }, body: sendMessageRequestSchema, response: messageSchema, status: 201 },
  { method: 'post', path: '/v1/conversations/{id}/delivered', summary: 'Record delivery up to seq (monotone, bounded by the last seq)', tags: ['messaging'], auth: 'user', params: { id: z.string() }, body: receiptRequestSchema, response: receiptStateSchema, status: 200 },
  { method: 'post', path: '/v1/conversations/{id}/read', summary: 'Record reading up to seq (monotone, bounded); the unread counter always follows, the receipt event hides it when readReceipts is off', tags: ['messaging'], auth: 'user', params: { id: z.string() }, body: receiptRequestSchema, response: receiptStateSchema, status: 200 },
  { method: 'get', path: '/v1/conversations/{id}/members', summary: 'Active members (lastReadSeq hidden for other users who disabled read receipts)', tags: ['messaging'], auth: 'user', params: { id: z.string() }, response: conversationMemberListSchema, status: 200 },
  { method: 'post', path: '/v1/conversations/{id}/members', summary: 'Add users to a group (admin or owner); returns the members actually added; full group: 409 group_full; audited', tags: ['messaging'], auth: 'user', params: { id: z.string() }, body: addConversationMembersRequestSchema, response: conversationMemberListSchema, status: 201 },
  { method: 'patch', path: '/v1/conversations/{id}/members/{userId}', summary: 'Change a member role (owner only; at least one owner must remain: 409 last_owner); audited', tags: ['messaging'], auth: 'user', params: { id: z.string(), userId: z.string() }, body: updateConversationMemberRequestSchema, response: conversationMemberSchema, status: 200 },
  { method: 'delete', path: '/v1/conversations/{id}/members/{userId}', summary: 'Leave (own id) or remove a member (admin or owner; an admin cannot remove an owner); the last owner leaving hands ownership over; audited', tags: ['messaging'], auth: 'user', params: { id: z.string(), userId: z.string() }, status: 204 },
  { method: 'put', path: '/v1/messages/{id}/reaction', summary: 'Set, or remove with emoji null, the single reaction of the caller to a message', tags: ['messaging'], auth: 'user', params: { id: z.string() }, body: reactionRequestSchema, response: messageSchema, status: 200 },
  { method: 'delete', path: '/v1/messages/{id}', summary: 'scope=me (default): hide for the caller. scope=all: the author recalls it within the recall window (409 afterwards), wiping body and media; audited', tags: ['messaging'], auth: 'user', params: { id: z.string() }, query: recallQuerySchema, status: 204 },
  // Lot 3b: forwarding, favourites, disappearing and scheduled messages, drafts. Same 404 rule as lot 3A.
  { method: 'post', path: '/v1/messages/{id}/forward', summary: 'Forward a readable, non-recalled message to 1-10 conversations; each destination follows every send rule and reports sent or error (not_found | not_allowed, no reason given); the copy has forwarded=true and no original author; idempotent per clientId', tags: ['messaging'], auth: 'user', params: { id: z.string() }, body: forwardMessageRequestSchema, response: forwardMessageResponseSchema, status: 200 },
  { method: 'put', path: '/v1/messages/{id}/favorite', summary: 'Favourite a message the caller can read (idempotent; recalled: 409; system message: 400)', tags: ['messaging'], auth: 'user', params: { id: z.string() }, status: 204 },
  { method: 'delete', path: '/v1/messages/{id}/favorite', summary: 'Remove a favourite (idempotent)', tags: ['messaging'], auth: 'user', params: { id: z.string() }, status: 204 },
  { method: 'get', path: '/v1/me/favorites', summary: 'Favourite messages, newest favourite first (cursor pagination); those whose access was lost (left conversation, recalled, expired, blocked sender) are masked', tags: ['messaging'], auth: 'user', query: favoriteListQuerySchema, response: favoriteListSchema, status: 200 },
  { method: 'get', path: '/v1/me/scheduled-messages', summary: 'Messages of the caller waiting for their send time (soonest first)', tags: ['messaging'], auth: 'user', response: scheduledMessageListSchema, status: 200 },
  { method: 'delete', path: '/v1/me/scheduled-messages/{id}', summary: 'Cancel a scheduled message before it is sent', tags: ['messaging'], auth: 'user', params: { id: z.string() }, status: 204 },
  { method: 'put', path: '/v1/conversations/{id}/draft', summary: 'Save the caller draft for this conversation (1-4000 chars, one per member, synced by the draft.updated event)', tags: ['messaging'], auth: 'user', params: { id: z.string() }, body: draftRequestSchema, response: draftSchema, status: 200 },
  { method: 'get', path: '/v1/conversations/{id}/draft', summary: 'The caller draft for this conversation (404 when none)', tags: ['messaging'], auth: 'user', params: { id: z.string() }, response: draftSchema, status: 200 },
  { method: 'delete', path: '/v1/conversations/{id}/draft', summary: 'Delete the caller draft (idempotent); sending a message also deletes it', tags: ['messaging'], auth: 'user', params: { id: z.string() }, status: 204 },
  // Lot 4B: stories, reports, moderation. A story the caller may not see (expired, hidden, blocked, other audience) is a 404.
  { method: 'post', path: '/v1/stories', summary: 'Publish a story (ready "story" upload of the caller; followers or friends); idempotent per clientId (201 new, 200 replay); flag social.stories', tags: ['stories'], auth: 'user', body: createStoryRequestSchema, response: storySchema, status: 201 },
  { method: 'get', path: '/v1/stories/feed', summary: 'Stories bar: the caller first, then followed authors, unseen first (max 100 authors)', tags: ['stories'], auth: 'user', response: storyFeedSchema, status: 200 },
  { method: 'get', path: '/v1/users/{userId}/stories', summary: 'Active stories of a user that the caller may see (blocked or unknown user: 404)', tags: ['stories'], auth: 'user', params: { userId: z.string() }, response: storyListSchema, status: 200 },
  { method: 'get', path: '/v1/me/stories/archive', summary: "The caller's personal archive: every story, expired included (cursor pagination)", tags: ['stories'], auth: 'user', query: storyPageQuerySchema, response: storyPageSchema, status: 200 },
  { method: 'post', path: '/v1/stories/{id}/view', summary: 'Mark a story as seen (idempotent)', tags: ['stories'], auth: 'user', params: { id: z.string() }, status: 204 },
  { method: 'get', path: '/v1/stories/{id}/viewers', summary: 'Who saw the story (author only, newest first; cursor pagination)', tags: ['stories'], auth: 'user', params: { id: z.string() }, query: storyPageQuerySchema, response: storyViewerListSchema, status: 200 },
  { method: 'delete', path: '/v1/stories/{id}', summary: 'Delete a story (author only)', tags: ['stories'], auth: 'user', params: { id: z.string() }, status: 204 },
  { method: 'post', path: '/v1/reports', summary: 'Report a user, post, comment, story or message the caller can see (invisible or unknown target: 404; open duplicate: 409; dedicated rate limit)', tags: ['moderation'], auth: 'user', body: createReportRequestSchema, response: reportSchema, status: 201 },
  { method: 'get', path: '/v1/me/reports', summary: "The caller's reports and whether they were handled (cursor pagination)", tags: ['moderation'], auth: 'user', query: pageQuerySchema, response: reportPageSchema, status: 200 },
  { method: 'get', path: '/v1/admin/moderation/reports', summary: 'Moderation queue: reports grouped by target (roles admin or moderator)', tags: ['admin', 'moderation'], auth: 'moderator', query: moderationReportsQuerySchema, response: moderationReportGroupPageSchema, status: 200 },
  { method: 'post', path: '/v1/admin/moderation/actions', summary: 'hide / restore / dismiss a reported item and resolve its open reports; audited without content (roles admin or moderator)', tags: ['admin', 'moderation'], auth: 'moderator', body: moderationActionRequestSchema, response: moderationActionResultSchema, status: 200 },
  // Social (lot 4A). Invisible, blocked, unknown or malformed ids: 404. Behind the `social` flag.
  { method: 'put', path: '/v1/users/{userId}/follow', summary: 'Follow a user (idempotent). Self: 400; unknown, inactive or blocked either way: 404; notifies the user once', tags: ['social'], auth: 'user', params: { userId: z.string() }, status: 204 },
  { method: 'delete', path: '/v1/users/{userId}/follow', summary: 'Unfollow a user (idempotent)', tags: ['social'], auth: 'user', params: { userId: z.string() }, status: 204 },
  { method: 'get', path: '/v1/users/{userId}/social', summary: 'Follower/following counts and the relation with the caller (isFollowing, followsYou)', tags: ['social'], auth: 'user', params: { userId: z.string() }, response: socialStatsSchema, status: 200 },
  { method: 'get', path: '/v1/users/{userId}/followers', summary: 'Followers, newest first (cursor pagination)', tags: ['social'], auth: 'user', params: { userId: z.string() }, query: socialPageQuerySchema, response: socialUserListSchema, status: 200 },
  { method: 'get', path: '/v1/users/{userId}/following', summary: 'Accounts followed, newest first (cursor pagination)', tags: ['social'], auth: 'user', params: { userId: z.string() }, query: socialPageQuerySchema, response: socialUserListSchema, status: 200 },
  { method: 'get', path: '/v1/users/{userId}/posts', summary: "A user's posts that the caller may see, newest first (cursor pagination)", tags: ['social'], auth: 'user', params: { userId: z.string() }, query: socialPageQuerySchema, response: postListSchema, status: 200 },
  { method: 'get', path: '/v1/feed', summary: "Visible posts of followed accounts plus the caller's own, newest first (cursor pagination)", tags: ['social'], auth: 'user', query: socialPageQuerySchema, response: postListSchema, status: 200 },
  { method: 'get', path: '/v1/feed/videos', summary: 'Short-video feed, simple version: recent public video posts in chronological order (no ranking)', tags: ['social'], auth: 'user', query: socialPageQuerySchema, response: postListSchema, status: 200 },
  { method: 'post', path: '/v1/posts', summary: 'Publish text and/or 0-10 ready post media of the caller (at most one video); idempotent per clientId (201 new, 200 replay); bad media: 400', tags: ['social'], auth: 'user', body: createPostRequestSchema, response: postSchema, status: 201 },
  { method: 'get', path: '/v1/posts/{id}', summary: 'One post with reaction counts and myReaction (visibility rules apply; invisible: 404)', tags: ['social'], auth: 'user', params: { id: z.string() }, response: postSchema, status: 200 },
  { method: 'patch', path: '/v1/posts/{id}', summary: 'Edit text and visibility (author only; others who can see it: 403)', tags: ['social'], auth: 'user', params: { id: z.string() }, body: updatePostRequestSchema, response: postSchema, status: 200 },
  { method: 'delete', path: '/v1/posts/{id}', summary: 'Soft-delete a post (author only)', tags: ['social'], auth: 'user', params: { id: z.string() }, status: 204 },
  { method: 'put', path: '/v1/posts/{id}/reaction', summary: "Set, change or remove (type null) the caller's single reaction; notifies the author once per reactor", tags: ['social'], auth: 'user', params: { id: z.string() }, body: setReactionRequestSchema, response: postSchema, status: 200 },
  { method: 'get', path: '/v1/posts/{id}/comments', summary: 'Comments of a visible post, oldest first (cursor pagination); comments of users blocked with the caller are left out', tags: ['social'], auth: 'user', params: { id: z.string() }, query: socialPageQuerySchema, response: commentListSchema, status: 200 },
  { method: 'post', path: '/v1/posts/{id}/comments', summary: 'Comment a visible post (1-2000 chars); replyToId must be a top-level comment of the same post', tags: ['social'], auth: 'user', params: { id: z.string() }, body: createCommentRequestSchema, response: commentSchema, status: 201 },
  { method: 'delete', path: '/v1/comments/{id}', summary: 'Delete a comment (its author or the post author)', tags: ['social'], auth: 'user', params: { id: z.string() }, status: 204 },
  // Lot 5A: catalogue. Seller routes need the org permission (non-member 404, member without it 403); flag `commerce` except the public storefront.
  { method: 'get', path: '/v1/catalog/categories', summary: 'Platform product categories', tags: ['catalog'], auth: 'user', response: productCategoryListSchema, status: 200 },
  { method: 'post', path: '/v1/orgs/{orgId}/products', summary: 'Create a product with 1-50 variants (prices in minor units, currency from COMMERCE_CURRENCIES, SKU unique per org: 409), 0-10 ready "product" media of org members; permission catalog.manage', tags: ['catalog'], auth: 'user', params: { orgId: z.string() }, body: createProductRequestSchema, response: productSchema, status: 201 },
  { method: 'get', path: '/v1/orgs/{orgId}/products', summary: 'Products of the org, all statuses (cursor pagination, filters status and q); permission catalog.manage or inventory.manage (reads only; writes need catalog.manage)', tags: ['catalog'], auth: 'user', params: { orgId: z.string() }, query: orgProductListQuerySchema, response: productListSchema, status: 200 },
  { method: 'get', path: '/v1/orgs/{orgId}/products/{productId}', summary: 'One product with exact stock; permission catalog.manage or inventory.manage', tags: ['catalog'], auth: 'user', params: { orgId: z.string(), productId: z.string() }, response: productSchema, status: 200 },
  { method: 'patch', path: '/v1/orgs/{orgId}/products/{productId}', summary: 'Edit a product; listed variants are updated (with id) or added, others untouched; publishing without an active variant: 409 details.reason publish_without_variant; SKU already used: 409 details {reason: sku_taken, field: sku, sku}, twice in the request: duplicate_sku_in_request', tags: ['catalog'], auth: 'user', params: { orgId: z.string(), productId: z.string() }, body: updateProductRequestSchema, response: productSchema, status: 200 },
  { method: 'delete', path: '/v1/orgs/{orgId}/products/{productId}', summary: 'Archive a product (never physically deleted; idempotent)', tags: ['catalog'], auth: 'user', params: { orgId: z.string(), productId: z.string() }, status: 204 },
  { method: 'post', path: '/v1/orgs/{orgId}/variants/{variantId}/stock', summary: 'Adjust stock by a delta (restock|adjustment|damage), journaled; never below 0 (409 details.reason stock_negative; untracked variant: stock_not_tracked); permission inventory.manage or catalog.manage', tags: ['catalog'], auth: 'user', params: { orgId: z.string(), variantId: z.string() }, body: adjustStockRequestSchema, response: variantSchema, status: 200 },
  { method: 'get', path: '/v1/products', summary: 'Marketplace search: published products of active public orgs (q, categoryId, orgId, minPrice, maxPrice, currency, sort recent|price_asc|price_desc, cursor); products of sellers blocked with the caller are hidden', tags: ['catalog'], auth: 'user', query: storefrontQuerySchema, response: storefrontProductListSchema, status: 200 },
  { method: 'get', path: '/v1/products/{id}', summary: 'Product detail with active variants and inStock (invisible: 404)', tags: ['catalog'], auth: 'user', params: { id: z.string() }, response: storefrontProductDetailSchema, status: 200 },
  { method: 'get', path: '/v1/public/orgs/{slug}/products', summary: 'Public storefront of an org, no token (unknown, private or suspended org: 404)', tags: ['catalog'], auth: 'public', params: { slug: z.string() }, query: orgStorefrontQuerySchema, response: storefrontProductListSchema, status: 200 },
  // Lot 5B: cart, orders, coupons, reviews. Behind the `commerce` flag. Unknown, foreign or malformed ids: 404.
  { method: 'get', path: '/v1/payment-methods', summary: 'Payment methods a checkout accepts (cash_on_delivery only until a payment partner is chosen)', tags: ['orders'], auth: 'user', response: paymentMethodListSchema, status: 200 },
  { method: 'get', path: '/v1/cart', summary: 'The caller cart grouped by organisation and currency, live prices; lines no longer buyable are listed in unavailable (no stock is reserved)', tags: ['cart'], auth: 'user', response: cartSchema, status: 200 },
  { method: 'put', path: '/v1/cart/items/{variantId}', summary: 'Set the quantity of a variant (0 removes it; max 99; max 100 lines: 409 cart_full; unknown or unbuyable variant: 404)', tags: ['cart'], auth: 'user', params: { variantId: z.string() }, body: setCartItemRequestSchema, response: cartSchema, status: 200 },
  { method: 'delete', path: '/v1/cart', summary: 'Empty the cart', tags: ['cart'], auth: 'user', status: 204 },
  { method: 'post', path: '/v1/orders/checkout', summary: 'One order per (organisation, currency), in one transaction with the stock reservation (refused: 409 details {reason, variantIds}; empty cart: 409). Idempotent per clientId (201 new, 200 replay). Bad coupon: 400 details {reason: expired|exhausted|min_not_reached|not_applicable, code}', tags: ['orders'], auth: 'user', body: checkoutRequestSchema, response: checkoutResponseSchema, status: 201 },
  { method: 'get', path: '/v1/orders', summary: 'Orders of the caller, newest first (status filter, cursor pagination)', tags: ['orders'], auth: 'user', query: orderListQuerySchema, response: orderListSchema, status: 200 },
  { method: 'get', path: '/v1/orders/{id}', summary: 'One order of the caller with its status history; contactUserId = seller support member to open a direct conversation with (null when blocked with the caller)', tags: ['orders'], auth: 'user', params: { id: z.string() }, response: orderDetailSchema, status: 200 },
  { method: 'post', path: '/v1/orders/{id}/cancel', summary: 'Cancel an order still pending (409 invalid_transition afterwards); gives the stock and the coupon use back', tags: ['orders'], auth: 'user', params: { id: z.string() }, body: cancelOrderRequestSchema, response: orderDetailSchema, status: 200 },
  { method: 'get', path: '/v1/orgs/{orgId}/orders', summary: 'Orders received by the organisation (orders.view; status filter, cursor pagination)', tags: ['orders', 'orgs'], auth: 'user', params: { orgId: z.string() }, query: orderListQuerySchema, response: orderListSchema, status: 200 },
  { method: 'get', path: '/v1/orgs/{orgId}/orders/{id}', summary: 'One order of the organisation with its status history (orders.view)', tags: ['orders', 'orgs'], auth: 'user', params: { orgId: z.string(), id: z.string() }, response: orderDetailSchema, status: 200 },
  { method: 'post', path: '/v1/orgs/{orgId}/orders/{id}/status', summary: 'Move an order forward (pending, confirmed, preparing, shipped, delivered) or cancel it before shipping; other transitions: 409 invalid_transition; audited; notifies the buyer (orders.manage)', tags: ['orders', 'orgs'], auth: 'user', params: { orgId: z.string(), id: z.string() }, body: updateOrderStatusRequestSchema, response: orderDetailSchema, status: 200 },
  { method: 'post', path: '/v1/orgs/{orgId}/coupons', summary: 'Create a coupon (percent 1-90 or fixed amount; optional currency, required for a fixed amount or any minimum, and then the coupon only applies to orders of that currency; code unique per org, case-insensitive: 409 code_taken; audited; orders.manage)', tags: ['orders', 'orgs'], auth: 'user', params: { orgId: z.string() }, body: createCouponRequestSchema, response: couponSchema, status: 201 },
  { method: 'get', path: '/v1/orgs/{orgId}/coupons', summary: 'Coupons of the organisation, newest first (orders.manage)', tags: ['orders', 'orgs'], auth: 'user', params: { orgId: z.string() }, query: couponListQuerySchema, response: couponListSchema, status: 200 },
  { method: 'patch', path: '/v1/orgs/{orgId}/coupons/{id}', summary: 'Deactivate a coupon (idempotent; audited; orders.manage)', tags: ['orders', 'orgs'], auth: 'user', params: { orgId: z.string(), id: z.string() }, body: updateCouponRequestSchema, response: couponSchema, status: 200 },
  { method: 'post', path: '/v1/products/{productId}/reviews', summary: 'Review a product (rating 1-5, text up to 2000). Only after a delivered order line for it (403 details.reason not_purchased); one per user and product (409 already_reviewed)', tags: ['reviews'], auth: 'user', params: { productId: z.string() }, body: createReviewRequestSchema, response: reviewSchema, status: 201 },
  { method: 'get', path: '/v1/products/{productId}/reviews', summary: 'Reviews of a product, newest first, with average and rating distribution (moderation-hidden ones only shown to their author)', tags: ['reviews'], auth: 'user', params: { productId: z.string() }, query: reviewListQuerySchema, response: reviewListSchema, status: 200 },
  { method: 'patch', path: '/v1/reviews/{reviewId}', summary: 'Edit own review (others: 403)', tags: ['reviews'], auth: 'user', params: { reviewId: z.string() }, body: updateReviewRequestSchema, response: reviewSchema, status: 200 },
  { method: 'delete', path: '/v1/reviews/{reviewId}', summary: 'Delete own review (others: 403)', tags: ['reviews'], auth: 'user', params: { reviewId: z.string() }, status: 204 },
  // Lot 6A: ledger and SANDBOX wallet (fictitious funds, every body carries mode 'sandbox'). Behind the `wallet.sandbox` flag.
  { method: 'get', path: '/v1/wallet', summary: 'Sandbox balances per currency and KYC tier (mode: sandbox, no real money)', tags: ['wallet'], auth: 'user', response: walletSchema, status: 200 },
  { method: 'get', path: '/v1/wallet/transactions', summary: 'Wallet history, newest first (currency filter, cursor); counterparty limited to name and @handle', tags: ['wallet'], auth: 'user', query: walletTransactionsQuerySchema, response: walletTransactionListSchema, status: 200 },
  { method: 'post', path: '/v1/wallet/transfers', summary: 'P2P transfer to a @handle, idempotent per clientId (201 new, 200 replay; same clientId with other values: 409 idempotency_mismatch). Unknown or blocked recipient: 404; self: 400; PIN not set 409 pin_not_set, wrong 403, locked 423; insufficient_funds / limit_exceeded 409; frozen account 403', tags: ['wallet'], auth: 'user', body: walletTransferRequestSchema, response: walletTransferResponseSchema, status: 201 },
  { method: 'post', path: '/v1/wallet/sandbox/topup', summary: 'Credit the caller with fictitious funds (capped per request and per hour; disabled in production unless WALLET_SANDBOX_TOPUP_ENABLED=true: 403 feature_disabled)', tags: ['wallet'], auth: 'user', body: sandboxTopupRequestSchema, response: walletTransferResponseSchema, status: 201 },
  { method: 'get', path: '/v1/orgs/{orgId}/wallet', summary: 'Sandbox balances of the organisation (finance.view)', tags: ['wallet', 'orgs'], auth: 'user', params: { orgId: z.string() }, response: orgWalletSchema, status: 200 },
  { method: 'get', path: '/v1/orgs/{orgId}/wallet/transactions', summary: 'History of the organisation wallet (finance.view)', tags: ['wallet', 'orgs'], auth: 'user', params: { orgId: z.string() }, query: walletTransactionsQuerySchema, response: walletTransactionListSchema, status: 200 },
  { method: 'get', path: '/v1/admin/ledger/accounts/{id}', summary: 'One ledger account with its cached and recomputed balance (admin)', tags: ['wallet', 'admin'], auth: 'admin', params: { id: z.string() }, response: adminLedgerAccountSchema, status: 200 },
  { method: 'post', path: '/v1/admin/ledger/accounts/{id}/freeze', summary: 'Freeze an account: no movement in or out (idempotent; audited; admin)', tags: ['wallet', 'admin'], auth: 'admin', params: { id: z.string() }, response: adminLedgerAccountSchema, status: 200 },
  { method: 'post', path: '/v1/admin/ledger/accounts/{id}/unfreeze', summary: 'Unfreeze an account (idempotent; audited; admin)', tags: ['wallet', 'admin'], auth: 'admin', params: { id: z.string() }, response: adminLedgerAccountSchema, status: 200 },
  { method: 'get', path: '/v1/admin/ledger/reconcile', summary: 'Compares each cached balance with the sum of its postings and the global sum per currency (must be 0)', tags: ['wallet', 'admin'], auth: 'admin', response: ledgerReconciliationSchema, status: 200 },
  { method: 'get', path: '/v1/orgs/{orgId}/reviews', summary: 'Reviews of all the products of the organisation with the product, newest first (cursor pagination; status all|unanswered; moderation-hidden ones excluded; orders.view or catalog.manage)', tags: ['reviews', 'orgs'], auth: 'user', params: { orgId: z.string() }, query: orgReviewListQuerySchema, response: orgReviewListSchema, status: 200 },
  { method: 'post', path: '/v1/orgs/{orgId}/reviews/{reviewId}/reply', summary: 'Reply as the seller to a review of one of the organisation products (replaces a previous reply; orders.manage)', tags: ['reviews', 'orgs'], auth: 'user', params: { orgId: z.string(), reviewId: z.string() }, body: reviewReplyRequestSchema, response: reviewSchema, status: 200 },
  // Lot 6B: KYC tiers (manual admin review, SANDBOX wallet limits), payment PIN, signed merchant QR. Identity files: purpose kyc_document, readable by the owner and admins only.
  { method: 'get', path: '/v1/me/kyc', summary: 'KYC level (0 OTP-verified, 1 declared identity + documents, 2 + proof of address), pending request, last decision and limits per currency', tags: ['kyc'], auth: 'user', response: kycStatusViewSchema, status: 200 },
  { method: 'post', path: '/v1/me/kyc/submissions', summary: 'Request level 1 (legal name, birth date 18+, document type and number [stored encrypted, only the last 4 characters ever exposed], city, documentIds [identity document, selfie]) or level 2 (documentIds [proof of address], needs level 1). One pending request: 409 details.reason pending_exists|already_verified|level_1_required', tags: ['kyc'], auth: 'user', body: createKycSubmissionRequestSchema, response: kycSubmissionSchema, status: 201 },
  { method: 'put', path: '/v1/me/payment-pin', summary: 'Set or change the 6-digit payment PIN (sequences and repetitions refused); requires the account password (401 otherwise); Argon2id; security notification', tags: ['kyc', 'wallet'], auth: 'user', body: setPaymentPinRequestSchema, status: 204 },
  { method: 'get', path: '/v1/admin/kyc/submissions', summary: 'KYC requests, oldest first (status filter, cursor pagination) (admin)', tags: ['kyc', 'admin'], auth: 'user', query: adminKycListQuerySchema, response: adminKycListSchema, status: 200 },
  { method: 'get', path: '/v1/admin/kyc/submissions/{id}', summary: 'One request with links to its documents (readable by admins through /v1/media/{id}/content); audited kyc.viewed (admin)', tags: ['kyc', 'admin'], auth: 'user', params: { id: z.string() }, response: adminKycSubmissionSchema, status: 200 },
  { method: 'post', path: '/v1/admin/kyc/submissions/{id}/decision', summary: 'Approve or reject (reason required to reject); audited; security notification to the user; already decided: 409; own request: 403 (admin)', tags: ['kyc', 'admin'], auth: 'user', params: { id: z.string() }, body: kycDecisionRequestSchema, response: adminKycSubmissionSchema, status: 200 },
  { method: 'post', path: '/v1/orgs/{orgId}/payment-qr', summary: 'Create a signed merchant QR (HMAC payload): fixed amount (default 15 min, single use) or free amount (static unless expiresInSeconds 60-86400); permission finance.view or orders.manage; flag wallet.sandbox', tags: ['wallet', 'orgs'], auth: 'user', params: { orgId: z.string() }, body: createPaymentQrRequestSchema, response: createdPaymentQrSchema, status: 201 },
  { method: 'get', path: '/v1/orgs/{orgId}/payment-qr', summary: 'QR codes of the organisation, newest first (cursor pagination; finance.view or orders.manage)', tags: ['wallet', 'orgs'], auth: 'user', params: { orgId: z.string() }, query: pageQuerySchema, response: paymentQrListSchema, status: 200 },
  { method: 'delete', path: '/v1/orgs/{orgId}/payment-qr/{qrId}', summary: 'Revoke a QR (idempotent; audited; finance.view or orders.manage)', tags: ['wallet', 'orgs'], auth: 'user', params: { orgId: z.string(), qrId: z.string() }, status: 204 },
  { method: 'post', path: '/v1/wallet/qr/resolve', summary: 'Check a scanned QR payload and return what it asks for (org identity, amount, currency, label). Refused: 400 details.reason invalid_qr|expired|revoked|already_used, nothing else revealed', tags: ['wallet'], auth: 'user', body: qrPayloadSchema, response: resolvedPaymentQrSchema, status: 200 },
  { method: 'post', path: '/v1/wallet/qr/pay', summary: 'Pay a merchant QR with the payment PIN (sandbox transfer, kind merchant_payment, idempotent per clientId). amountMinor required for a free-amount QR (400 amount_required), ignored otherwise. PIN: 409 pin_not_set, 403 pin_invalid, 423 pin_locked (5 wrong PINs lock 15 min), all with details.reason; funds/limits: 409 details.reason; single-use QR consumed in the same transaction; notifies finance.view members', tags: ['wallet'], auth: 'user', body: payQrRequestSchema, response: payQrResponseSchema, status: 200 },
  // Lot 7: places and universal search. Behind the `search` flag. Coordinates belong to organisations; no user position is stored.
  { method: 'post', path: '/v1/orgs/{orgId}/location', summary: 'Publish the location of the organisation (lat, lng, optional label); already set: 409 location_exists; audited; permission org.profile.edit', tags: ['places', 'orgs'], auth: 'user', params: { orgId: z.string() }, body: setOrgLocationRequestSchema, response: orgLocationSchema, status: 201 },
  { method: 'patch', path: '/v1/orgs/{orgId}/location', summary: 'Move the location or change its label (null clears it); no location yet: 404; audited; permission org.profile.edit', tags: ['places', 'orgs'], auth: 'user', params: { orgId: z.string() }, body: updateOrgLocationRequestSchema, response: orgLocationSchema, status: 200 },
  { method: 'delete', path: '/v1/orgs/{orgId}/location', summary: 'Remove the location (idempotent; audited); permission org.profile.edit', tags: ['places', 'orgs'], auth: 'user', params: { orgId: z.string() }, status: 204 },
  { method: 'get', path: '/v1/places', summary: 'Public active organisations within radiusKm (max 50, default 10) of lat/lng, nearest first (kind, q, cursor pagination); haversine in SQL; the position is never stored', tags: ['places'], auth: 'user', query: placesQuerySchema, response: placeListSchema, status: 200 },
  { method: 'get', path: '/v1/search', summary: 'Universal search over users (active, by @handle or name; phone/e-mail only as exact match when the owner allows it; blocks excluded), public organisations, storefront-visible products and posts visible to the caller. Ranking: exact, prefix, contains. scope=all returns 5 per category, other scopes paginate (cursor); dedicated rate limit; first page recorded in the history unless disabled', tags: ['search'], auth: 'user', query: searchQuerySchema, response: searchResultSchema, status: 200 },
  { method: 'get', path: '/v1/me/search-history', summary: 'The caller search history, newest first, at most 50, and whether it is enabled (never shared)', tags: ['search'], auth: 'user', response: searchHistorySchema, status: 200 },
  { method: 'delete', path: '/v1/me/search-history', summary: 'Clear the whole search history', tags: ['search'], auth: 'user', status: 204 },
  { method: 'delete', path: '/v1/me/search-history/{id}', summary: 'Delete one search history entry (unknown or foreign: 404)', tags: ['search'], auth: 'user', params: { id: z.string() }, status: 204 },
  { method: 'patch', path: '/v1/me/search-history/settings', summary: 'Enable or disable the recording of the search history (enabled by default; disabling keeps existing entries)', tags: ['search'], auth: 'user', body: searchHistorySettingsSchema, response: searchHistorySettingsSchema, status: 200 },
];
