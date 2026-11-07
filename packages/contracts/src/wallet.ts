import { z } from 'zod';

/* Lot 6A: double-entry ledger and SANDBOX wallet. See docs/architecture/API_CONTRACTS.md.
 * No real money (CDC §17, ADR-013): every balance and answer carries mode 'sandbox'. Amounts are integers in
 * minor units of the currency. */

export const WALLET_NOTE_MAX = 140;
/** Upper bound of one amount, well inside Number.MAX_SAFE_INTEGER. */
export const WALLET_AMOUNT_MAX = 1_000_000_000_000;

export const walletModeSchema = z.literal('sandbox');
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const amountSchema = z.number().int().min(1).max(WALLET_AMOUNT_MAX);

export const walletBalanceSchema = z.object({
  currency: currencySchema,
  balanceMinor: z.number().int(),
  status: z.enum(['active', 'frozen']),
});
export type WalletBalance = z.infer<typeof walletBalanceSchema>;

export const walletSchema = z.object({
  mode: walletModeSchema,
  kycTier: z.number().int().min(0).max(2),
  balances: z.array(walletBalanceSchema),
});
export type Wallet = z.infer<typeof walletSchema>;

export const orgWalletSchema = z.object({
  mode: walletModeSchema,
  balances: z.array(walletBalanceSchema),
});
export type OrgWallet = z.infer<typeof orgWalletSchema>;

/** The other side of a movement: only what is displayable (name and handle, or organisation name). */
export const walletCounterpartySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.uuid(), displayName: z.string(), handle: z.string() }),
  z.object({ kind: z.literal('org'), orgId: z.uuid(), name: z.string(), slug: z.string() }),
  z.object({ kind: z.literal('system'), label: z.string() }),
]);
export type WalletCounterparty = z.infer<typeof walletCounterpartySchema>;

export const walletTransactionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['p2p', 'merchant_payment', 'sandbox_topup', 'refund', 'adjustment']),
  direction: z.enum(['in', 'out']),
  amountMinor: z.number().int().min(1),
  currency: currencySchema,
  counterparty: walletCounterpartySchema.nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type WalletTransaction = z.infer<typeof walletTransactionSchema>;

export const walletTransactionListSchema = z.object({
  mode: walletModeSchema,
  items: z.array(walletTransactionSchema),
  nextCursor: z.string().nullable(),
});
export type WalletTransactionList = z.infer<typeof walletTransactionListSchema>;

export const walletTransactionsQuerySchema = z.object({
  currency: currencySchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type WalletTransactionsQuery = z.infer<typeof walletTransactionsQuerySchema>;

export const walletTransferRequestSchema = z.object({
  /** Idempotency key: a retry with the same clientId returns the first transfer, never a second one. */
  clientId: z.uuid(),
  /** Handle of the recipient, with or without a leading @. */
  toHandle: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((v) => v.replace(/^@/, '').toLowerCase()),
  amountMinor: amountSchema,
  currency: currencySchema,
  note: z.string().trim().min(1).max(WALLET_NOTE_MAX).optional(),
  /** Transaction PIN (checked by the KYC/PIN module). */
  pin: z.string().min(1).max(16),
});
export type WalletTransferRequest = z.infer<typeof walletTransferRequestSchema>;

export const walletTransferResponseSchema = z.object({
  mode: walletModeSchema,
  transferId: z.uuid(),
  replayed: z.boolean(),
  amountMinor: z.number().int(),
  currency: currencySchema,
  /** Caller balance after the movement (current balance on a replay). */
  balanceMinor: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type WalletTransferResponse = z.infer<typeof walletTransferResponseSchema>;

export const sandboxTopupRequestSchema = z.object({
  clientId: z.uuid(),
  amountMinor: amountSchema,
  currency: currencySchema,
});
export type SandboxTopupRequest = z.infer<typeof sandboxTopupRequestSchema>;

/** 409/403/423 `details` of a refused transfer. */
export const walletRefusalReasonSchema = z.enum([
  'insufficient_funds',
  'limit_exceeded',
  'account_frozen',
  'idempotency_mismatch',
  'pin_not_set',
  'pin_invalid',
  'pin_locked',
]);
export type WalletRefusalReason = z.infer<typeof walletRefusalReasonSchema>;

/** `details` of a PIN refusal, on wallet transfers and QR payments: 403 wrong PIN, 423 locked. */
export const pinRefusalDetailsSchema = z.discriminatedUnion('reason', [
  z.object({ reason: z.literal('pin_invalid'), attemptsRemaining: z.number().int().min(0) }),
  z.object({ reason: z.literal('pin_locked'), lockedUntil: z.iso.datetime() }),
]);
export type PinRefusalDetails = z.infer<typeof pinRefusalDetailsSchema>;

/* ------------------------------------------------------------------ admin */

export const adminLedgerAccountSchema = z.object({
  id: z.uuid(),
  ownerKind: z.enum(['user', 'org', 'system']),
  userId: z.uuid().nullable(),
  orgId: z.uuid().nullable(),
  systemCode: z.enum(['sandbox_funding', 'fees']).nullable(),
  currency: currencySchema,
  status: z.enum(['active', 'frozen']),
  balanceMinor: z.number().int(),
  /** Sum of the postings of the account; differs from balanceMinor only if the cache was tampered with. */
  ledgerBalanceMinor: z.number().int(),
  allowNegative: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type AdminLedgerAccount = z.infer<typeof adminLedgerAccountSchema>;

export const ledgerReconciliationSchema = z.object({
  mode: walletModeSchema,
  checkedAt: z.iso.datetime(),
  accountsChecked: z.number().int(),
  /** Accounts whose cached balance differs from the sum of their postings. */
  divergences: z.array(
    z.object({ accountId: z.uuid(), currency: currencySchema, cachedMinor: z.number().int(), ledgerMinor: z.number().int() }),
  ),
  /** Sum of all postings per currency: must be 0. */
  currencyTotals: z.array(z.object({ currency: currencySchema, totalMinor: z.number().int() })),
  ok: z.boolean(),
});
export type LedgerReconciliation = z.infer<typeof ledgerReconciliationSchema>;

/* ------------------------------------------------------------------ export */

export const exportedWalletSchema = z.object({
  mode: walletModeSchema,
  balances: z.array(walletBalanceSchema),
  transactions: z.array(walletTransactionSchema),
});
export type ExportedWallet = z.infer<typeof exportedWalletSchema>;
