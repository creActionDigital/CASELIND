import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AiCatalogEntry, aiCatalogEntrySchema } from '@caselind/contracts';
import { z } from 'zod';
import { DEFAULT_AI_MODELS } from '../ai/default-catalog.js';

const MIB = 1024 * 1024;

/** Hex when the string is hex, base64 otherwise. */
export function decodeKeyMaterial(v: string): Buffer {
  return /^(?:[0-9a-f]{2})+$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
}

const kycTierLimitsSchema = z.object({
  maxBalanceMinor: z.number().int().min(0),
  maxSingleTransferMinor: z.number().int().min(0),
  maxDailyOutgoingMinor: z.number().int().min(0),
});
const kycLimitsOverrideSchema = z.record(z.string().regex(/^[A-Z]{3}$/), z.record(z.enum(['0', '1', '2']), kycTierLimitsSchema));
export type KycLimitsOverride = z.infer<typeof kycLimitsOverrideSchema>;

const mobilityTariffSchema = z.object({
  baseMinor: z.number().int().min(0),
  perKmMinor: z.number().int().min(0),
  perMinMinor: z.number().int().min(0),
  minFareMinor: z.number().int().min(0),
});
const mobilityTariffsOverrideSchema = z.record(
  z.string().regex(/^[A-Z]{3}$/),
  z.record(z.enum(['moto', 'standard', 'confort']), mobilityTariffSchema),
);
export type MobilityTariffsOverride = z.infer<typeof mobilityTariffsOverrideSchema>;

const aiCatalogSchema = z
  .array(aiCatalogEntrySchema)
  .min(1)
  .refine((a) => new Set(a.map((e) => e.id)).size === a.length, 'duplicate model id');

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
    /** Alias kept for compatibility: `console` is the default of both channels below. */
    OTP_PROVIDER: z.enum(['console']).default('console'),
    /** e-mail codes: `brevo` (transactional API) or `console` (server log, never in production). */
    OTP_EMAIL_PROVIDER: z.enum(['brevo', 'console']).optional(),
    /** phone codes: `whatsapp` (Cloud API authentication template) or `console` (never in production). */
    OTP_PHONE_PROVIDER: z.enum(['whatsapp', 'console']).optional(),
    BREVO_API_KEY: z.string().min(1).optional(),
    /** Verified sender address of the e-mail codes (Brevo sender or domain). */
    OTP_EMAIL_FROM: z.string().email().optional(),
    OTP_EMAIL_FROM_NAME: z.string().min(1).default('CASELIND'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
    /** Name of the approved WhatsApp authentication template. */
    WHATSAPP_OTP_TEMPLATE: z.string().min(1).optional(),
    WHATSAPP_TEMPLATE_LANG: z.string().min(2).default('fr'),
    WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/, 'WHATSAPP_GRAPH_VERSION looks like v21.0').default('v21.0'),
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
    /** Lot 7: per-client budget for GET /v1/search (each call runs up to four queries). */
    SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
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
    /** Lot 6A: max sandbox top-up per request, in USD minor units (other currencies scale by a rough rate). */
    WALLET_SANDBOX_TOPUP_MAX_MINOR: z.coerce.number().int().min(1).default(100_00),
    /** Lot 6A: sandbox top-up is always allowed outside production; in production only when this is `true`. */
    WALLET_SANDBOX_TOPUP_ENABLED: z.enum(['true', 'false']).optional(),
    /** How long after sending the author may recall a message for everyone (409 afterwards). */
    MESSAGE_RECALL_WINDOW_SECONDS: z.coerce.number().int().min(0).max(86400).default(120),
    /** Lot 3b: false = the minute job that sends scheduled messages is not started on this instance. */
    MESSAGING_SCHEDULER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /**
     * Lot 6B: key encrypting identity document numbers (AES-256-GCM). Hex or base64 of at least 32 bytes
     * (generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"). Required in
     * production; elsewhere a key derived from JWT_ACCESS_SECRET is used when absent.
     */
    KYC_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine((v) => v === undefined || decodeKeyMaterial(v).length >= 32, 'KYC_ENCRYPTION_KEY must be hex or base64 of at least 32 bytes'),
    /**
     * Lot 1c: key encrypting TOTP secrets (AES-256-GCM). Hex or base64 of at least 32 bytes. Required in
     * production; elsewhere a key derived from JWT_ACCESS_SECRET is used when absent.
     */
    TOTP_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine((v) => v === undefined || decodeKeyMaterial(v).length >= 32, 'TOTP_ENCRYPTION_KEY must be hex or base64 of at least 32 bytes'),
    /**
     * Lot 18a: key encrypting personal health data (AES-256-GCM, bound to the user). Hex or base64 of at least 32 bytes.
     * Required in production; elsewhere a key derived from JWT_ACCESS_SECRET is used when absent.
     */
    HEALTH_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine((v) => v === undefined || decodeKeyMaterial(v).length >= 32, 'HEALTH_ENCRYPTION_KEY must be hex or base64 of at least 32 bytes'),
    /** Lot 18a: minute job turning due medication reminders into doses and notifications. */
    HEALTH_REMINDERS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** Lot 1c: polling budget of the public QR login status route (the web client polls every 1-2 s). */
    QR_POLL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(90),
    /** Lot 10: POST /oauth/token (per IP), on top of the default budget. */
    OAUTH_TOKEN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),
    /** Lot 6B: signs merchant payment QR payloads (HMAC-SHA256). Required in production; derived elsewhere when absent. */
    PAYMENT_QR_SECRET: z.string().min(32, 'PAYMENT_QR_SECRET must be at least 32 characters').optional(),
    /** Lot 6B: per-currency, per-KYC-tier limits as JSON, e.g. {"USD":{"1":{"maxBalanceMinor":1,"maxSingleTransferMinor":1,"maxDailyOutgoingMinor":1}}}; unlisted entries use the defaults. */
    KYC_LIMITS: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || v.trim() === '') return undefined;
        try {
          return kycLimitsOverrideSchema.parse(JSON.parse(v));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'KYC_LIMITS must be a JSON object {CUR: {"0"|"1"|"2": {maxBalanceMinor, maxSingleTransferMinor, maxDailyOutgoingMinor}}}' });
          return z.NEVER;
        }
      }),
    /** Lot 6B: wrong payment PINs before the lock, and the lock duration. */
    PAYMENT_PIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    PAYMENT_PIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /** Lot 11: tariffs per currency and ride type as JSON {CUR: {moto|standard|confort: {baseMinor, perKmMinor, perMinMinor, minFareMinor}}}; unlisted entries use the Goma defaults. */
    MOBILITY_TARIFFS: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || v.trim() === '') return undefined;
        try {
          return mobilityTariffsOverrideSchema.parse(JSON.parse(v));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'MOBILITY_TARIFFS must be a JSON object {CUR: {moto|standard|confort: {baseMinor, perKmMinor, perMinMinor, minFareMinor}}}' });
          return z.NEVER;
        }
      }),
    /** Lot 11: straight-line distance multiplier approximating the road distance. */
    MOBILITY_DETOUR_FACTOR: z.coerce.number().min(1).max(3).default(1.35),
    /** Lot 11: radius around the pick-up point in which online drivers receive a request. */
    MOBILITY_PICKUP_RADIUS_KM: z.coerce.number().min(0.5).max(50).default(5),
    /** Lot 12: provider keys. Without its key a provider is simply unavailable. */
    GEMINI_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    MISTRAL_API_KEY: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    /** Any other OpenAI-compatible service (model entries with provider "custom"). */
    AI_CUSTOM_BASE_URL: z.url().optional(),
    AI_CUSTOM_API_KEY: z.string().min(1).optional(),
    /** Lot 12: model catalogue as a JSON array of entries; empty = built-in defaults. */
    AI_MODELS: z
      .string()
      .optional()
      .transform((v, ctx): AiCatalogEntry[] => {
        if (v === undefined || v.trim() === '') return DEFAULT_AI_MODELS;
        try {
          return aiCatalogSchema.parse(JSON.parse(v));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'AI_MODELS must be a JSON array of {id, provider, model, label, free, trainsOnData, dataPolicy} with unique ids' });
          return z.NEVER;
        }
      }),
    /** Lot 12: messages (and product descriptions) one user may ask the assistant per UTC day. */
    AI_DAILY_MESSAGES: z.coerce.number().int().min(1).default(50),
    /** Lot 12: per-client budget for the generating routes. */
    AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    /** Lot 12: provider call timeout (no automatic retry). */
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(16).max(8192).default(1024),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const key of ['KYC_ENCRYPTION_KEY', 'PAYMENT_QR_SECRET', 'TOTP_ENCRYPTION_KEY', 'HEALTH_ENCRYPTION_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
      }
    }
    const isProd = env.NODE_ENV === 'production';
    const need = (names: (keyof typeof env)[], provider: string) => {
      for (const name of names) {
        if (!env[name]) {
          ctx.addIssue({ code: 'custom', path: [name], message: `${name} is required when ${provider} is the OTP provider` });
        }
      }
    };
    const { email, phone } = resolveOtpProviders(env);
    if (isProd && email === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_EMAIL_PROVIDER'],
        message:
          'the console OTP provider (OTP_PROVIDER=console is an alias) must not be used in production for e-mail; set OTP_EMAIL_PROVIDER=brevo',
      });
    }
    if (isProd && phone === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_PHONE_PROVIDER'],
        message:
          'the console OTP provider (OTP_PROVIDER=console is an alias) must not be used in production for phone numbers; set OTP_PHONE_PROVIDER=whatsapp',
      });
    }
    if (email === 'brevo') need(['BREVO_API_KEY', 'OTP_EMAIL_FROM'], 'brevo');
    if (phone === 'whatsapp') {
      need(['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_OTP_TEMPLATE'], 'whatsapp');
    }
  });

/** Provider of each channel: the specific variable wins, then the OTP_PROVIDER alias (default console). */
export function resolveOtpProviders(env: {
  OTP_PROVIDER: 'console';
  OTP_EMAIL_PROVIDER?: 'brevo' | 'console' | undefined;
  OTP_PHONE_PROVIDER?: 'whatsapp' | 'console' | undefined;
}): { email: 'brevo' | 'console'; phone: 'whatsapp' | 'console' } {
  return { email: env.OTP_EMAIL_PROVIDER ?? env.OTP_PROVIDER, phone: env.OTP_PHONE_PROVIDER ?? env.OTP_PROVIDER };
}

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
