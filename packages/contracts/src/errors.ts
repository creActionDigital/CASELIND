import { z } from 'zod';

/**
 * Every non-2xx API response uses this envelope.
 * `code` is stable and machine-readable; `message` is for humans and may change.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const ErrorCodes = {
  validationFailed: 'validation_failed',
  unauthenticated: 'unauthenticated',
  invalidCredentials: 'invalid_credentials',
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
  rateLimited: 'rate_limited',
  accountLocked: 'account_locked',
  accountNotVerified: 'account_not_verified',
  accountSuspended: 'account_suspended',
  otpInvalid: 'otp_invalid',
  otpExpired: 'otp_expired',
  otpResendTooSoon: 'otp_resend_too_soon',
  refreshTokenInvalid: 'refresh_token_invalid',
  featureDisabled: 'feature_disabled',
  /** 413: the uploaded content exceeds the size limit (details.maxBytes). */
  payloadTooLarge: 'payload_too_large',
  /** 415: the content type is not accepted, or does not match the declared one (details.reason). */
  unsupportedMediaType: 'unsupported_media_type',
  /** 409: the selected model may train on submitted data and the user has not accepted the notice. */
  dataNoticeRequired: 'data_notice_required',
  /** 503: no AI model is available (none enabled with a configured key). */
  aiUnavailable: 'ai_unavailable',
  /** 502: the AI provider failed; details.reason is a short kind, never provider content. */
  aiProviderError: 'ai_provider_error',
  /** 409: a consent (details.kind: ai_processing, translation) must be granted before the content leaves for a provider. */
  consentRequired: 'consent_required',
  internal: 'internal_error',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
