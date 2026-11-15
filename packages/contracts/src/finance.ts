import { z } from 'zod';

const currencySchema = z.string().regex(/^[A-Z]{3}$/);

/** Sandbox only: amounts are fictitious, in minor units of the currency. */
export const setBudgetRequestSchema = z.object({
  currency: currencySchema,
  limitMinor: z.number().int().positive().max(1_000_000_000_000),
});
export type SetBudgetRequest = z.infer<typeof setBudgetRequestSchema>;

export const financeSummaryQuerySchema = z.object({
  /** UTC month, YYYY-MM. Defaults to the current month. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});
export type FinanceSummaryQuery = z.infer<typeof financeSummaryQuerySchema>;

export const spendingKindSchema = z.enum(['p2p', 'merchant_payment']);

export const financeCurrencySummarySchema = z.object({
  currency: currencySchema,
  spentMinor: z.number().int(),
  receivedMinor: z.number().int(),
  /** Money out, per kind of movement (transfers to people, shop payments). */
  byKind: z.array(z.object({ kind: spendingKindSchema, spentMinor: z.number().int() })),
  budgetMinor: z.number().int().nullable(),
  remainingMinor: z.number().int().nullable(),
  /** spent / budget in percent, can exceed 100. */
  usedPercent: z.number().int().nullable(),
});
export type FinanceCurrencySummary = z.infer<typeof financeCurrencySummarySchema>;

export const financeSummarySchema = z.object({
  mode: z.literal('sandbox'),
  month: z.string(),
  items: z.array(financeCurrencySummarySchema),
});
export type FinanceSummary = z.infer<typeof financeSummarySchema>;

export const budgetSchema = z.object({ mode: z.literal('sandbox'), currency: currencySchema, limitMinor: z.number().int() });
export type Budget = z.infer<typeof budgetSchema>;

export const removeBudgetQuerySchema = z.object({ currency: currencySchema });
export type RemoveBudgetQuery = z.infer<typeof removeBudgetQuerySchema>;
