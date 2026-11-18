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
  /** Set once the sale is voided (stock given back); voided sales leave the day summary. */
  voidedAt: z.string().nullable(),
});
export type PosSale = z.infer<typeof posSaleSchema>;
export const posSaleListSchema = z.object({ items: z.array(posSaleSchema) });
export type PosSaleList = z.infer<typeof posSaleListSchema>;

/** GET /pos/sales: the latest sales of the shop. */
export const posSaleListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
export type PosSaleListQuery = z.infer<typeof posSaleListQuerySchema>;

/** POST /pos/sales/{id}/void. */
export const voidPosSaleRequestSchema = z.object({ reason: z.string().trim().max(200).optional() });
export type VoidPosSaleRequest = z.infer<typeof voidPosSaleRequestSchema>;

/** Receipt: the sale and the shop header (name, address, phone). */
export const posTicketSchema = z.object({
  sale: posSaleSchema,
  shop: z.object({ name: z.string(), address: z.string().nullable(), phone: z.string().nullable() }),
});
export type PosTicket = z.infer<typeof posTicketSchema>;

/** Totals of the current day in the shop's time zone (not voided sales), one row per currency. */
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

/** Cash drawer session: opening float counted in, then cash counted out. At most one open session per shop. */
export const openPosShiftRequestSchema = z.object({
  currency: z.enum(['USD', 'CDF']),
  openingFloatMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type OpenPosShiftRequest = z.infer<typeof openPosShiftRequestSchema>;

export const closePosShiftRequestSchema = z.object({ countedCashMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
export type ClosePosShiftRequest = z.infer<typeof closePosShiftRequestSchema>;

export const posShiftSchema = z.object({
  id: z.uuid(),
  currency: z.enum(['USD', 'CDF']),
  openingFloatMinor: z.number().int(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  countedCashMinor: z.number().int().nullable(),
});
export type PosShift = z.infer<typeof posShiftSchema>;
/** The open session, or `{ shift: null }`. */
export const currentPosShiftSchema = z.object({ shift: posShiftSchema.nullable() });
export type CurrentPosShift = z.infer<typeof currentPosShiftSchema>;

/** Closing report: expected = float + cash sales of the session (not voided, session currency); difference = counted - expected. */
export const posShiftReportSchema = z.object({
  shift: posShiftSchema,
  expectedCashMinor: z.number().int(),
  countedCashMinor: z.number().int(),
  differenceMinor: z.number().int(),
});
export type PosShiftReport = z.infer<typeof posShiftReportSchema>;
