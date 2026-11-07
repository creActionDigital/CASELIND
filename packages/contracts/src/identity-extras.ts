// Lot 1c: TOTP two-factor authentication, identifier change, QR web login.
import { z } from 'zod';
import { deviceSchema, identifierSchema, otpCodeSchema, tokenPairSchema } from './auth.js';

/** Login answer when the account has 2FA: no token yet, the client continues with POST /auth/2fa/verify. */
export const twoFactorRequiredSchema = z.object({
  twoFactorRequired: z.literal(true),
  challengeId: z.uuid(),
});
export type TwoFactorRequired = z.infer<typeof twoFactorRequiredSchema>;

/**
 * POST /auth/login answer: a TokenPair (2FA inactive, unchanged shape) or a two-factor challenge.
 * Discriminate on the presence of `twoFactorRequired`.
 */
export const loginResponseSchema = z.union([tokenPairSchema, twoFactorRequiredSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

const passwordProofSchema = z.string().min(1).max(128);
/** Backup codes look like `abcde-fghij` (case and dash are ignored when checking). */
export const backupCodeSchema = z.string().trim().min(8).max(32);

export const totpSetupResponseSchema = z.object({
  /** Base32 secret, shown once at enrolment. */
  secret: z.string(),
  /** otpauth:// URI for the QR code of the authenticator app (issuer CASELIND). */
  otpauthUri: z.string(),
});
export type TotpSetupResponse = z.infer<typeof totpSetupResponseSchema>;

export const totpEnableRequestSchema = z.object({ code: otpCodeSchema, password: passwordProofSchema });
export type TotpEnableRequest = z.infer<typeof totpEnableRequestSchema>;

/** The 10 single-use backup codes, returned once. */
export const totpEnableResponseSchema = z.object({ backupCodes: z.array(z.string()).length(10) });
export type TotpEnableResponse = z.infer<typeof totpEnableResponseSchema>;

const oneSecondFactor = (v: { code?: string | undefined; backupCode?: string | undefined }) =>
  (v.code === undefined) !== (v.backupCode === undefined);
const oneSecondFactorMessage = { message: 'provide exactly one of code or backupCode', path: ['code'] };

export const totpDisableRequestSchema = z
  .object({ password: passwordProofSchema, code: otpCodeSchema.optional(), backupCode: backupCodeSchema.optional() })
  .refine(oneSecondFactor, oneSecondFactorMessage);
export type TotpDisableRequest = z.infer<typeof totpDisableRequestSchema>;

export const twoFactorVerifyRequestSchema = z
  .object({
    challengeId: z.uuid(),
    code: otpCodeSchema.optional(),
    backupCode: backupCodeSchema.optional(),
    device: deviceSchema,
  })
  .refine(oneSecondFactor, oneSecondFactorMessage);
export type TwoFactorVerifyRequest = z.infer<typeof twoFactorVerifyRequestSchema>;

export const identifierChangeRequestSchema = z.object({
  newIdentifier: identifierSchema,
  password: passwordProofSchema,
});
export type IdentifierChangeRequest = z.infer<typeof identifierChangeRequestSchema>;

export const identifierChangeVerifySchema = z.object({ challengeId: z.uuid(), code: otpCodeSchema });
export type IdentifierChangeVerify = z.infer<typeof identifierChangeVerifySchema>;

/* QR web login */

export const qrSessionRequestSchema = z.object({ device: deviceSchema });
export type QrSessionRequest = z.infer<typeof qrSessionRequestSchema>;

export const qrSessionResponseSchema = z.object({
  qrSessionId: z.uuid(),
  /** Text to encode in the QR code. Contains no secret that lets the holder poll for the tokens. */
  qrPayload: z.string(),
  expiresAt: z.iso.datetime(),
  /** Polling secret: kept by the web client, sent in the `X-QR-Session-Secret` header, never put in the QR. */
  sessionSecret: z.string(),
});
export type QrSessionResponse = z.infer<typeof qrSessionResponseSchema>;

export const qrApproveRequestSchema = z.object({
  qrPayload: z.string().min(10).max(200),
  /** false (default) only previews the requesting device; true approves (explicit user confirmation). */
  confirm: z.boolean().default(false),
});
export type QrApproveRequest = z.infer<typeof qrApproveRequestSchema>;

export const qrApproveResponseSchema = z.object({
  status: z.enum(['confirmation_required', 'approved']),
  device: z.object({ name: z.string().nullable(), platform: z.string(), ip: z.string().nullable() }),
  requestedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type QrApproveResponse = z.infer<typeof qrApproveResponseSchema>;

/** `approved` carries the tokens exactly once; later polls answer `expired`. */
export const qrSessionStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('approved'), tokens: tokenPairSchema }),
]);
export type QrSessionStatus = z.infer<typeof qrSessionStatusSchema>;
