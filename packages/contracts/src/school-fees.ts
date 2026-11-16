import { z } from 'zod';

/**
 * School fee statements (lot 17h, CDC §13). A record kept by the school: the platform takes and moves no money.
 * The school states a fee for a class and marks which enrolled students paid it outside the platform.
 */
export const createFeeRequestSchema = z.object({
  title: z.string().trim().min(1).max(80),
  amountMinor: z.number().int().min(1).max(1_000_000_000_000),
  currency: z.enum(['USD', 'CDF']),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').optional(),
});
export type CreateFeeRequest = z.infer<typeof createFeeRequestSchema>;

export const markFeeRequestSchema = z.object({ handle: z.string().trim().min(1).max(40), paid: z.boolean() });
export type MarkFeeRequest = z.infer<typeof markFeeRequestSchema>;

export const schoolFeeSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  dueOn: z.string().nullable(),
  /** Staff view: how many students paid out of how many owe it. */
  paidCount: z.number().int(),
  studentCount: z.number().int(),
});
export type SchoolFee = z.infer<typeof schoolFeeSchema>;
export const schoolFeeListSchema = z.object({ items: z.array(schoolFeeSchema) });
export type SchoolFeeList = z.infer<typeof schoolFeeListSchema>;

export const feeStatusListSchema = z.object({ items: z.array(z.object({ handle: z.string(), displayName: z.string(), paid: z.boolean() })) });
export type FeeStatusList = z.infer<typeof feeStatusListSchema>;

/** What an enrolled person sees: `paid` is null for a parent or teacher (only students owe a fee). */
export const myFeeSchema = z.object({
  id: z.uuid(),
  className: z.string(),
  schoolName: z.string(),
  title: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  dueOn: z.string().nullable(),
  paid: z.boolean().nullable(),
});
export type MyFee = z.infer<typeof myFeeSchema>;
export const myFeeListSchema = z.object({ items: z.array(myFeeSchema) });
export type MyFeeList = z.infer<typeof myFeeListSchema>;
