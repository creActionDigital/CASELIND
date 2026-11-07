// Lot 6B KYC, payment PIN and merchant QR tables (0014_kyc_qr.sql is the source of truth; keep this mirror in sync).
import { bigint, boolean, date, integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const kycProfiles = pgTable('kyc_profiles', {
  userId: uuid('user_id').primaryKey(),
  level: smallint('level').notNull().default(0),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const kycSubmissions = pgTable('kyc_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  level: smallint('level').notNull(),
  status: text('status').$type<'pending' | 'approved' | 'rejected'>().notNull().default('pending'),
  legalName: text('legal_name'),
  birthDate: date('birth_date'),
  idType: text('id_type'),
  idNumberEnc: text('id_number_enc'),
  idNumberLast4: text('id_number_last4'),
  city: text('city'),
  documentIds: uuid('document_ids').array().notNull(),
  decidedBy: uuid('decided_by'),
  decidedAt: tstz('decided_at'),
  decisionReason: text('decision_reason'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
export type KycSubmissionRow = typeof kycSubmissions.$inferSelect;

export const paymentPins = pgTable('payment_pins', {
  userId: uuid('user_id').primaryKey(),
  pinHash: text('pin_hash').notNull(),
  failedCount: integer('failed_count').notNull().default(0),
  lockedUntil: tstz('locked_until'),
  setAt: tstz('set_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const paymentQrCodes = pgTable('payment_qr_codes', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  createdBy: uuid('created_by').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }),
  currency: text('currency').notNull(),
  label: text('label'),
  expiresAt: tstz('expires_at'),
  singleUse: boolean('single_use').notNull().default(false),
  revokedAt: tstz('revoked_at'),
  consumedAt: tstz('consumed_at'),
  consumedBy: uuid('consumed_by'),
  consumedClientId: uuid('consumed_client_id'),
  consumedTransferId: uuid('consumed_transfer_id'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
export type PaymentQrRow = typeof paymentQrCodes.$inferSelect;
