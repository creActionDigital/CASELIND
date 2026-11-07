// Lot 6A ledger tables (0013_ledger.sql is the source of truth; keep this mirror in sync).
import { bigint, bigserial, boolean, char, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const minor = (name: string) => bigint(name, { mode: 'number' });

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerKind: text('owner_kind').$type<'user' | 'org' | 'system'>().notNull(),
  userId: uuid('user_id'),
  orgId: uuid('org_id'),
  systemCode: text('system_code').$type<'sandbox_funding' | 'fees'>(),
  currency: char('currency', { length: 3 }).notNull(),
  status: text('status').$type<'active' | 'frozen'>().notNull().default('active'),
  balanceMinor: minor('balance_minor').notNull().default(0),
  allowNegative: boolean('allow_negative').notNull().default(false),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  initiatedBy: uuid('initiated_by'),
  currency: char('currency', { length: 3 }).notNull(),
  amountMinor: minor('amount_minor').notNull(),
  metadata: jsonb('metadata').$type<Record<string, string>>().notNull().default({}),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const postings = pgTable('postings', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  entryId: uuid('entry_id').notNull(),
  accountId: uuid('account_id').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  amountMinor: minor('amount_minor').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
