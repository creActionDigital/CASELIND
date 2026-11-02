import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { TokenPair } from '@caselind/contracts';
import pg from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { OtpSender, type OtpMessage } from '../src/auth/otp-sender.js';
import type { AppModuleOptions } from '../src/app.module.js';
import { createApp } from '../src/bootstrap.js';
import { type Env, loadEnv } from '../src/config/env.js';
import { migrate } from '../src/db/migrator.js';

/** Captures outgoing OTP messages instead of sending them. */
export class CapturingOtpSender extends OtpSender {
  readonly messages: OtpMessage[] = [];

  async send(message: OtpMessage): Promise<void> {
    this.messages.push(message);
  }

  lastCodeFor(destination: string): string {
    const msg = [...this.messages].reverse().find((m) => m.kind === 'code' && m.destination === destination);
    if (!msg || msg.kind !== 'code') throw new Error(`no code sent to ${destination}`);
    return msg.code;
  }
}

export interface TestContext {
  app: INestApplication;
  http: ReturnType<typeof request>;
  otp: CapturingOtpSender;
  databaseUrl: string;
  /** Direct SQL access for assertions and fixtures. */
  sql: pg.Pool;
  close(): Promise<void>;
}

/** Creates a fresh, migrated database and a fully wired app for one test file. */
export async function createTestContext(
  envOverrides: Record<string, string> = {},
  options: Pick<AppModuleOptions, 'extraControllers'> = {},
): Promise<TestContext> {
  const adminUrl = inject('pgAdminUrl');
  const dbName = `caselind_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const databaseUrl = url.toString();
  await migrate(databaseUrl);
  const mediaDir = await mkdtemp(join(tmpdir(), 'caselind-media-'));

  const env: Env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    OTP_PEPPER: randomBytes(32).toString('hex'),
    MEDIA_SIGNING_SECRET: randomBytes(32).toString('hex'),
    // One media directory per test file, removed by close().
    MEDIA_STORAGE_DIR: mediaDir,
    OTP_RESEND_COOLDOWN_SECONDS: '0',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_PER_MINUTE: '10000',
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
    MEDIA_RATE_LIMIT_PER_MINUTE: '10000',
    MAINTENANCE_ENABLED: 'false',
    ...envOverrides,
  });
  const otp = new CapturingOtpSender();
  const app = await createApp({ env, otpSender: otp, ...options });
  await app.init();
  const sql = new pg.Pool({ connectionString: databaseUrl, max: 2 });

  return {
    app,
    http: request(app.getHttpServer()),
    otp,
    databaseUrl,
    sql,
    async close() {
      await app.close();
      await sql.end();
      await rm(mediaDir, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

let counter = 0;

/** Unique e-mail per call so tests within a file never collide. */
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.test`;
}

export const PASSWORD = 'correct-horse-battery';

/** Registers and verifies an account, returning its tokens. */
export async function signUp(
  ctx: TestContext,
  identifier = uniqueEmail(),
  displayName = 'Test User',
): Promise<{ identifier: string; tokens: TokenPair }> {
  const reg = await ctx.http
    .post('/v1/auth/register')
    .send({ identifier, password: PASSWORD, displayName })
    .expect(202);
  const code = ctx.otp.lastCodeFor(identifier);
  const verified = await ctx.http
    .post('/v1/auth/otp/verify')
    .send({ challengeId: reg.body.challengeId, code, device: { name: 'Test device', platform: 'android' } })
    .expect(200);
  return { identifier, tokens: verified.body as TokenPair };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
