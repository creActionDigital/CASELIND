import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';
import { walletModeSchema } from './wallet.js';

/* Finance du portefeuille (migrations/0090 et 0091) : demandes d'argent, paiements partages, paiements programmes,
 * tirelires et alertes d'anomalie. MODE TEST : tout est de l'argent FICTIF du portefeuille sandbox, jamais de l'argent
 * reel, et rien n'est connecte a un operateur de Mobile Money. Les montants sont des entiers en unites mineures. */

export const MONEY_REQUEST_NOTE_MAX = 140;
export const MONEY_REQUEST_TTL_DAYS = 14;
export const MONEY_REQUESTS_PENDING_MAX = 20;
export const SPLIT_TITLE_MAX = 80;
/** Participants autres que le createur : 1 a 19 (soit 2 a 20 personnes au total, createur compris). */
export const SPLIT_PARTICIPANTS_MAX = 19;
export const SCHEDULED_NOTE_MAX = 100;
export const SCHEDULED_ACTIVE_MAX = 10;
export const SCHEDULED_FAILURES_MAX = 3;
export const SAVINGS_TITLE_MAX = 60;

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const amountSchema = z.number().int().min(1).max(1_000_000_000_000);
const pinSchema = z.string().min(1).max(16);
const handleSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((v) => v.replace(/^@/, '').toLowerCase());

export const financePartySchema = z.object({ userId: z.uuid(), displayName: z.string(), handle: z.string() });
export type FinanceParty = z.infer<typeof financePartySchema>;

/* ---------------------------------------------------------------- pure helpers (API and mobile) */

/** Splits `total` into `parts` shares that sum EXACTLY to it: the first `total % parts` shares get one extra minor unit. */
export function splitEqual(total: number, parts: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isInteger(parts) || parts < 1) return [];
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

export type ScheduledFrequency = 'once' | 'weekly' | 'monthly';

const DAY_MS = 86_400_000;

/**
 * Date (UTC) of the n-th run (n = 0 is `first`). Weekly: +7 days each. Monthly: same day of the month, brought back to
 * the last day of shorter months (31 January, 28 February, 31 March: no drift because it is always derived from `first`).
 */
export function scheduledRunAt(first: Date, frequency: ScheduledFrequency, n: number): Date {
  if (frequency === 'once' || n <= 0) return new Date(first.getTime());
  if (frequency === 'weekly') return new Date(first.getTime() + n * 7 * DAY_MS);
  const months = first.getUTCMonth() + n;
  const year = first.getUTCFullYear() + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const d = new Date(first.getTime());
  d.setUTCFullYear(year, month, Math.min(first.getUTCDate(), daysInMonth));
  return d;
}

/** The next `count` run dates starting at run number `runsDone` (0-based), honouring `maxRuns` and `endsOn` (YYYY-MM-DD, inclusive). */
export function upcomingRuns(
  p: { first: Date; frequency: ScheduledFrequency; runsDone: number; maxRuns: number | null; endsOn: string | null },
  count: number,
): Date[] {
  const out: Date[] = [];
  const limit = p.frequency === 'once' ? 1 : (p.maxRuns ?? Infinity);
  for (let n = p.runsDone; n < limit && out.length < count; n++) {
    const at = scheduledRunAt(p.first, p.frequency, n);
    if (p.endsOn && at.toISOString().slice(0, 10) > p.endsOn) break;
    out.push(at);
  }
  return out;
}

/* ---------------------------------------------------------------- money requests */

export const moneyRequestStatusSchema = z.enum(['pending', 'paid', 'declined', 'cancelled', 'expired']);
export type MoneyRequestStatus = z.infer<typeof moneyRequestStatusSchema>;

export const createMoneyRequestSchema = z
  .object({
    /** Idempotency key: a retry returns the first request. */
    clientId: z.uuid(),
    payerHandle: handleSchema.optional(),
    payerId: z.uuid().optional(),
    amountMinor: amountSchema,
    currency: currencySchema,
    note: z.string().trim().min(1).max(MONEY_REQUEST_NOTE_MAX).optional(),
  })
  .refine((v) => (v.payerHandle ? 1 : 0) + (v.payerId ? 1 : 0) === 1, { message: 'give payerHandle or payerId' });
export type CreateMoneyRequest = z.infer<typeof createMoneyRequestSchema>;

export const moneyRequestSchema = z.object({
  mode: walletModeSchema,
  id: z.uuid(),
  /** 'sent' = the caller asked for the money, 'received' = the caller is asked to pay. */
  direction: z.enum(['sent', 'received']),
  counterparty: financePartySchema,
  amountMinor: z.number().int(),
  currency: currencySchema,
  note: z.string().nullable(),
  status: moneyRequestStatusSchema,
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  paidTransferId: z.uuid().nullable(),
  billId: z.uuid().nullable(),
  billTitle: z.string().nullable(),
});
export type MoneyRequest = z.infer<typeof moneyRequestSchema>;

export const moneyRequestListQuerySchema = pageQuerySchema.extend({
  direction: z.enum(['sent', 'received']).optional(),
  status: moneyRequestStatusSchema.optional(),
});
export type MoneyRequestListQuery = z.infer<typeof moneyRequestListQuerySchema>;

export const moneyRequestListSchema = z.object({ mode: walletModeSchema, items: z.array(moneyRequestSchema), nextCursor: z.string().nullable() });
export type MoneyRequestList = z.infer<typeof moneyRequestListSchema>;

export const payMoneyRequestSchema = z.object({ pin: pinSchema });
export type PayMoneyRequest = z.infer<typeof payMoneyRequestSchema>;

export const payMoneyRequestResponseSchema = z.object({ mode: walletModeSchema, replayed: z.boolean(), request: moneyRequestSchema });
export type PayMoneyRequestResponse = z.infer<typeof payMoneyRequestResponseSchema>;

/* ---------------------------------------------------------------- split bills */

export const splitBillStatusSchema = z.enum(['open', 'settled', 'cancelled']);
export type SplitBillStatus = z.infer<typeof splitBillStatusSchema>;

export const createSplitBillSchema = z
  .object({
    clientId: z.uuid(),
    title: z.string().trim().min(1).max(SPLIT_TITLE_MAX),
    currency: currencySchema,
    totalMinor: amountSchema,
    /** 'equal': the total is shared between the participants AND the creator; 'custom': `amountMinor` per participant, the creator keeps the rest. */
    split: z.enum(['equal', 'custom']),
    participants: z
      .array(
        z
          .object({ handle: handleSchema.optional(), userId: z.uuid().optional(), amountMinor: amountSchema.optional() })
          .refine((p) => (p.handle ? 1 : 0) + (p.userId ? 1 : 0) === 1, { message: 'give handle or userId' }),
      )
      .min(1)
      .max(SPLIT_PARTICIPANTS_MAX),
  })
  .refine((v) => v.split === 'equal' || v.participants.every((p) => p.amountMinor !== undefined), {
    message: 'amountMinor is required for each participant in a custom split',
    path: ['participants'],
  });
export type CreateSplitBill = z.infer<typeof createSplitBillSchema>;

export const splitBillShareSchema = z.object({
  user: financePartySchema,
  amountMinor: z.number().int(),
  status: z.enum(['pending', 'paid', 'declined']),
  transferId: z.uuid().nullable(),
  requestId: z.uuid().nullable(),
});
export type SplitBillShare = z.infer<typeof splitBillShareSchema>;

export const splitBillSchema = z.object({
  mode: walletModeSchema,
  id: z.uuid(),
  title: z.string(),
  totalMinor: z.number().int(),
  selfMinor: z.number().int(),
  currency: currencySchema,
  status: splitBillStatusSchema,
  createdAt: z.iso.datetime(),
  paidMinor: z.number().int(),
  shares: z.array(splitBillShareSchema),
});
export type SplitBill = z.infer<typeof splitBillSchema>;

export const splitBillListSchema = z.object({ mode: walletModeSchema, items: z.array(splitBillSchema), nextCursor: z.string().nullable() });
export type SplitBillList = z.infer<typeof splitBillListSchema>;

/* ---------------------------------------------------------------- scheduled payments */

export const scheduledFrequencySchema = z.enum(['once', 'weekly', 'monthly']);
export const scheduledStatusSchema = z.enum(['active', 'paused', 'completed', 'cancelled', 'failed']);
export type ScheduledStatus = z.infer<typeof scheduledStatusSchema>;

export const createScheduledPaymentSchema = z
  .object({
    clientId: z.uuid(),
    recipientHandle: handleSchema.optional(),
    recipientId: z.uuid().optional(),
    amountMinor: amountSchema,
    currency: currencySchema,
    note: z.string().trim().min(1).max(SCHEDULED_NOTE_MAX).optional(),
    frequency: scheduledFrequencySchema,
    /** First run (ISO date-time, not in the past, within one year). */
    firstRunAt: z.iso.datetime(),
    /** Last day (YYYY-MM-DD, inclusive) on which a run may happen. */
    endsOn: z.iso.date().optional(),
    maxRuns: z.number().int().min(1).max(1000).optional(),
    /** The owner authorises the recurring payment with the transaction PIN. */
    pin: pinSchema,
  })
  .refine((v) => (v.recipientHandle ? 1 : 0) + (v.recipientId ? 1 : 0) === 1, { message: 'give recipientHandle or recipientId' });
export type CreateScheduledPayment = z.infer<typeof createScheduledPaymentSchema>;

export const scheduledPaymentSchema = z.object({
  mode: walletModeSchema,
  id: z.uuid(),
  recipient: financePartySchema,
  amountMinor: z.number().int(),
  currency: currencySchema,
  note: z.string().nullable(),
  frequency: scheduledFrequencySchema,
  nextRunAt: z.iso.datetime().nullable(),
  endsOn: z.string().nullable(),
  maxRuns: z.number().int().nullable(),
  runsDone: z.number().int(),
  status: scheduledStatusSchema,
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ScheduledPayment = z.infer<typeof scheduledPaymentSchema>;

export const scheduledRunSchema = z.object({
  runNumber: z.number().int(),
  status: z.enum(['ok', 'failed']),
  errorCode: z.string().nullable(),
  transferId: z.uuid().nullable(),
  ranAt: z.iso.datetime(),
});
export type ScheduledRun = z.infer<typeof scheduledRunSchema>;

export const scheduledPaymentDetailSchema = scheduledPaymentSchema.extend({ runs: z.array(scheduledRunSchema) });
export type ScheduledPaymentDetail = z.infer<typeof scheduledPaymentDetailSchema>;

export const scheduledPaymentListSchema = z.object({ mode: walletModeSchema, items: z.array(scheduledPaymentSchema), nextCursor: z.string().nullable() });
export type ScheduledPaymentList = z.infer<typeof scheduledPaymentListSchema>;

export const nextRunsQuerySchema = z.object({ count: z.coerce.number().int().min(1).max(12).default(5) });
export type NextRunsQuery = z.infer<typeof nextRunsQuerySchema>;
export const nextRunsSchema = z.object({ mode: walletModeSchema, items: z.array(z.iso.datetime()) });
export type NextRuns = z.infer<typeof nextRunsSchema>;

/* ---------------------------------------------------------------- savings goals (tirelires) */

export const createSavingsGoalSchema = z.object({
  title: z.string().trim().min(1).max(SAVINGS_TITLE_MAX),
  targetMinor: amountSchema,
  currency: currencySchema,
  deadline: z.iso.date().optional(),
});
export type CreateSavingsGoal = z.infer<typeof createSavingsGoalSchema>;

export const savingsGoalSchema = z.object({
  mode: walletModeSchema,
  id: z.uuid(),
  title: z.string(),
  targetMinor: z.number().int(),
  currency: currencySchema,
  savedMinor: z.number().int(),
  /** 0 to 100 (capped). */
  progressPercent: z.number().int().min(0).max(100),
  deadline: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type SavingsGoal = z.infer<typeof savingsGoalSchema>;

export const savingsGoalListSchema = z.object({ mode: walletModeSchema, items: z.array(savingsGoalSchema) });
export type SavingsGoalList = z.infer<typeof savingsGoalListSchema>;

export const savingsMoveSchema = z.object({ clientId: z.uuid(), amountMinor: amountSchema, pin: pinSchema });
export type SavingsMove = z.infer<typeof savingsMoveSchema>;

export const savingsMoveResponseSchema = z.object({
  mode: walletModeSchema,
  replayed: z.boolean(),
  goal: savingsGoalSchema,
  /** Balance of the current account after the movement. */
  balanceMinor: z.number().int(),
});
export type SavingsMoveResponse = z.infer<typeof savingsMoveResponseSchema>;

/* ---------------------------------------------------------------- anomaly alerts */

export const walletAlertRuleSchema = z.enum(['amount_outlier', 'burst', 'new_recipient_large', 'many_recipients']);
export type WalletAlertRule = z.infer<typeof walletAlertRuleSchema>;
export const walletAlertSeveritySchema = z.enum(['info', 'warn', 'high']);
export type WalletAlertSeverity = z.infer<typeof walletAlertSeveritySchema>;

export const walletAlertSchema = z.object({
  mode: walletModeSchema,
  id: z.uuid(),
  rule: walletAlertRuleSchema,
  severity: walletAlertSeveritySchema,
  transferId: z.uuid().nullable(),
  status: z.enum(['open', 'reviewed', 'dismissed']),
  /** True once the user answered "this is not me". */
  reported: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type WalletAlert = z.infer<typeof walletAlertSchema>;

export const walletAlertListSchema = z.object({ mode: walletModeSchema, items: z.array(walletAlertSchema), nextCursor: z.string().nullable() });
export type WalletAlertList = z.infer<typeof walletAlertListSchema>;

export const adminWalletAlertsQuerySchema = pageQuerySchema.extend({
  status: z.enum(['open', 'reviewed', 'dismissed']).optional(),
  /** Only the alerts the user reported as "not me". */
  reported: z.enum(['true', 'false']).optional(),
});
export type AdminWalletAlertsQuery = z.infer<typeof adminWalletAlertsQuerySchema>;

export const adminWalletAlertSchema = walletAlertSchema.extend({ user: financePartySchema });
export type AdminWalletAlert = z.infer<typeof adminWalletAlertSchema>;
export const adminWalletAlertListSchema = z.object({ mode: walletModeSchema, items: z.array(adminWalletAlertSchema), nextCursor: z.string().nullable() });
export type AdminWalletAlertList = z.infer<typeof adminWalletAlertListSchema>;

/* ---------------------------------------------------------------- account export */

export const exportedWalletFinanceSchema = z.object({
  mode: walletModeSchema,
  moneyRequests: z.array(
    z.object({
      id: z.uuid(),
      direction: z.enum(['sent', 'received']),
      amountMinor: z.number().int(),
      currency: currencySchema,
      status: moneyRequestStatusSchema,
      createdAt: z.iso.datetime(),
    }),
  ),
  splitBills: z.array(
    z.object({ id: z.uuid(), title: z.string(), totalMinor: z.number().int(), currency: currencySchema, status: splitBillStatusSchema, participants: z.number().int(), createdAt: z.iso.datetime() }),
  ),
  scheduledPayments: z.array(
    z.object({
      id: z.uuid(),
      amountMinor: z.number().int(),
      currency: currencySchema,
      frequency: scheduledFrequencySchema,
      status: scheduledStatusSchema,
      runsDone: z.number().int(),
      createdAt: z.iso.datetime(),
    }),
  ),
  savingsGoals: z.array(
    z.object({ id: z.uuid(), title: z.string(), targetMinor: z.number().int(), savedMinor: z.number().int(), currency: currencySchema, deadline: z.string().nullable(), archived: z.boolean(), createdAt: z.iso.datetime() }),
  ),
  alerts: z.array(
    z.object({ id: z.uuid(), rule: walletAlertRuleSchema, severity: walletAlertSeveritySchema, status: z.enum(['open', 'reviewed', 'dismissed']), reported: z.boolean(), createdAt: z.iso.datetime() }),
  ),
});
export type ExportedWalletFinance = z.infer<typeof exportedWalletFinanceSchema>;
