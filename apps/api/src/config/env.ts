import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const MIB = 1024 * 1024;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
    /** console = codes written to the server log; only allowed outside production. */
    OTP_PROVIDER: z.enum(['console']).default('console'),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Days between a deletion request and the anonymisation of the account (login cancels it meanwhile). */
    ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /** false = the hourly cleanup job is not scheduled on this instance. */
    MAINTENANCE_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** Signs the short-lived upload tokens of POST /v1/media/uploads. */
    MEDIA_SIGNING_SECRET: z.string().min(32, 'MEDIA_SIGNING_SECRET must be at least 32 characters'),
    /**
     * Local-disk media storage (objects/ + staging tmp/). Relative paths are resolved against the
     * working directory; the default is apps/api/.data/media (git-ignored). Staging always happens
     * here, even once an S3-compatible adapter exists (pending decision Q6).
     */
    MEDIA_STORAGE_DIR: z
      .string()
      .min(1)
      .default(fileURLToPath(new URL('../../.data/media', import.meta.url)))
      .transform((v) => resolve(v)),
    MEDIA_MAX_IMAGE_BYTES: z.coerce.number().int().min(1).default(10 * MIB),
    MEDIA_MAX_VIDEO_BYTES: z.coerce.number().int().min(1).default(100 * MIB),
    MEDIA_MAX_AUDIO_BYTES: z.coerce.number().int().min(1).default(20 * MIB),
    MEDIA_MAX_DOCUMENT_BYTES: z.coerce.number().int().min(1).default(20 * MIB),
    /** Unfinished uploads (pending or rejected, purged after 24 h) one user may have at once. */
    MEDIA_MAX_PENDING_PER_USER: z.coerce.number().int().min(1).default(20),
    /** Bytes one user may hold: ready sizes plus the declared sizes of pending uploads (default 1 GiB). */
    MEDIA_QUOTA_BYTES_PER_USER: z.coerce.number().int().min(1).default(1024 * MIB),
    /** Stricter per-client budget for announcing uploads, sending their bytes and re-issuing tokens. */
    MEDIA_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),
    /** Per-client budget for sending messages (the send route only). */
    MESSAGING_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    /** Lot 4B: lifetime of a story. */
    STORY_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    /** Lot 4B: per-client budget for filing reports (the create route only). */
    REPORTS_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    /** Push provider: `log` only journals (nothing is delivered), `expo` calls the Expo Push API. */
    PUSH_PROVIDER: z.enum(['expo', 'log']).default('log'),
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
    /** Seconds between rechecks of the sessions of connected sockets; 0 disables the safety net. */
    REALTIME_SESSION_RECHECK_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    /** Maximum active members of one group conversation. */
    MESSAGING_GROUP_MAX_MEMBERS: z.coerce.number().int().min(2).max(5000).default(500),
    /** Lot 5A: currencies a variant price may use (comma-separated ISO 4217 codes). */
    COMMERCE_CURRENCIES: z
      .string()
      .default('USD,CDF')
      .transform((v) => v.split(',').map((c) => c.trim().toUpperCase()).filter((c) => c.length > 0))
      .refine((a) => a.length > 0 && a.every((c) => /^[A-Z]{3}$/.test(c)), 'COMMERCE_CURRENCIES must be a list of ISO 4217 codes'),
    /** How long after sending the author may recall a message for everyone (409 afterwards). */
    MESSAGE_RECALL_WINDOW_SECONDS: z.coerce.number().int().min(0).max(86400).default(120),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.OTP_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_PROVIDER'],
        message: 'the console OTP provider must not be used in production; configure a real SMS/e-mail provider',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
