// Lot 1c tables (0018_identity_extras.sql is the source of truth; keep this mirror in sync).
import { bigint, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const userTotp = pgTable('user_totp', {
  userId: uuid('user_id').primaryKey(),
  secretEnc: text('secret_enc').notNull(),
  enabledAt: tstz('enabled_at'),
  lastUsedStep: bigint('last_used_step', { mode: 'number' }).notNull().default(0),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const userBackupCodes = pgTable('user_backup_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  codeHash: text('code_hash').notNull(),
  usedAt: tstz('used_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const twoFactorChallenges = pgTable('two_factor_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  deviceName: text('device_name'),
  platform: text('platform').notNull().default('other'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  expiresAt: tstz('expires_at').notNull(),
  consumedAt: tstz('consumed_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const qrLoginSessions = pgTable('qr_login_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  nonceHash: text('nonce_hash').notNull(),
  secretHash: text('secret_hash').notNull(),
  deviceName: text('device_name'),
  platform: text('platform').notNull().default('web'),
  ip: text('ip'),
  status: text('status').$type<'pending' | 'approved' | 'consumed'>().notNull().default('pending'),
  approvedBy: uuid('approved_by'),
  approvedAt: tstz('approved_at'),
  expiresAt: tstz('expires_at').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
