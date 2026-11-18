import { z } from 'zod';

/* Lot 16c: caisse. The seller records a counter sale; the platform moves no money (payment method is a label). */

export const POS_PAYMENT_METHODS = ['cash', 'mobile_money', 'card'] as const;
export const posPaymentMethodSchema = z.enum(POS_PAYMENT_METHODS);

export const createPosSaleRequestSchema = z.object({
  /** Idempotency key: a retried request returns the same sale. */
  clientId: z.uuid(),
  paymentMethod: posPaymentMethodSchema,
  lines: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(999) })).min(1).max(50),
});
export type CreatePosSaleRequest = z.infer<typeof createPosSaleRequestSchema>;

export const posSaleSchema = z.object({
  id: z.uuid(),
  currency: z.enum(['USD', 'CDF']),
  totalMinor: z.number().int(),
  paymentMethod: posPaymentMethodSchema,
  lines: z.array(z.object({ title: z.string(), variantLabel: z.string().nullable(), quantity: z.number().int(), unitPriceMinor: z.number().int() })),
  createdAt: z.string(),
});
export type PosSale = z.infer<typeof posSaleSchema>;
export const posSaleListSchema = z.object({ items: z.array(posSaleSchema) });
export type PosSaleList = z.infer<typeof posSaleListSchema>;

/** Totals of the current UTC day, one row per currency. */
export const posSummarySchema = z.object({
  items: z.array(
    z.object({
      currency: z.enum(['USD', 'CDF']),
      salesCount: z.number().int(),
      totalMinor: z.number().int(),
      byMethod: z.object({ cash: z.number().int(), mobile_money: z.number().int(), card: z.number().int() }),
    }),
  ),
});
export type PosSummary = z.infer<typeof posSummarySchema>;
