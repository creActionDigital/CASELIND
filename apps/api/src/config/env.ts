import { z } from 'zod';

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
