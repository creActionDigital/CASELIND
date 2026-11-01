import { z } from 'zod';

/** E.164 phone number, e.g. +243812345678 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'phone must be in E.164 format (e.g. +243812345678)');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Either an e-mail or an E.164 phone number. */
export const identifierSchema = z.union([phoneSchema, emailSchema]);

export const passwordSchema = z
  .string()
  .min(10, 'password must contain at least 10 characters')
  .max(128, 'password must contain at most 128 characters');

export const deviceSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    platform: z.enum(['ios', 'android', 'web', 'other']).default('other'),
  })
  .default({ platform: 'other' });

export const localeSchema = z.enum(['fr', 'en', 'sw']);

export const registerRequestSchema = z.object({
  identifier: identifierSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80),
  locale: localeSchema.default('fr'),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, 'country must be an ISO 3166-1 alpha-2 code')
    .optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Returned whether or not the identifier already exists (anti-enumeration). */
export const challengeResponseSchema = z.object({
  challengeId: z.uuid(),
  channel: z.enum(['sms', 'email']),
  expiresAt: z.iso.datetime(),
});
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;

export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'code must be 6 digits');

export const verifyOtpRequestSchema = z.object({
  challengeId: z.uuid(),
  code: otpCodeSchema,
  device: deviceSchema,
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;

export const resendOtpRequestSchema = z.object({ challengeId: z.uuid() });

export const loginRequestSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1).max(128),
  device: deviceSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({ refreshToken: z.string().min(20).max(200) });

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
  sessionId: z.uuid(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const forgotPasswordRequestSchema = z.object({ identifier: identifierSchema });

export const resetPasswordRequestSchema = z.object({
  challengeId: z.uuid(),
  code: otpCodeSchema,
  newPassword: passwordSchema,
});

export const sessionSchema = z.object({
  id: z.uuid(),
  deviceName: z.string().nullable(),
  platform: z.string(),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;
