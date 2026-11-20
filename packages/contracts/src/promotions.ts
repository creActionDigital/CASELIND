import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * Promotions on products, flash sales and wishlist. Mirrors migrations/0076 and 0077.
 * The effective price is always computed by the server; a client never sends a price.
 */

export const PROMOTION_MAX_DAYS = 30;
/** A promotion running at most this long also appears in the flash sales list. */
export const FLASH_MAX_HOURS = 72;

export const promotionKindSchema = z.enum(['percent', 'fixed_price']);
export type PromotionKind = z.infer<typeof promotionKindSchema>;
export const promotionStatusSchema = z.enum(['scheduled', 'active', 'ended', 'stopped', 'exhausted']);
export type PromotionStatus = z.infer<typeof promotionStatusSchema>;

/** Public part, on storefront cards and variants. */
export const promotionBadgeSchema = z.object({ label: z.string(), endsAt: z.string(), kind: promotionKindSchema });
export type PromotionBadge = z.infer<typeof promotionBadgeSchema>;

const labelSchema = z.string().trim().min(1).max(40);
const MS_DAY = 86_400_000;

export const createPromotionRequestSchema = z
  .object({
    productId: z.string().uuid(),
    /** Absent = the whole product (every active variant). */
    variantId: z.string().uuid().nullish(),
    kind: promotionKindSchema,
    /** percent: 1-90; fixed_price: the new price in minor units (below the current price). */
    value: z.number().int().min(1).max(1_000_000_000_000),
    label: labelSchema,
    /** Default: now. */
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }),
    /** Units sold at the promotional price; beyond it the base price applies. */
    stockCap: z.number().int().min(1).max(1_000_000).nullish(),
  })
  .superRefine((b, ctx) => {
    if (b.kind === 'percent' && b.value > 90) ctx.addIssue({ code: 'custom', path: ['value'], message: 'percent must be between 1 and 90' });
    const start = b.startsAt ? Date.parse(b.startsAt) : Date.now();
    const end = Date.parse(b.endsAt);
    if (end <= start) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'must be after the start' });
    else if (end - start > PROMOTION_MAX_DAYS * MS_DAY) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: `at most ${PROMOTION_MAX_DAYS} days` });
    if (end <= Date.now()) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'must be in the future' });
  });
export type CreatePromotionRequest = z.infer<typeof createPromotionRequestSchema>;

/** `active: false` stops the promotion (it cannot be restarted: create another one). */
export const updatePromotionRequestSchema = z
  .object({
    label: labelSchema.optional(),
    endsAt: z.iso.datetime({ offset: true }).optional(),
    stockCap: z.number().int().min(1).max(1_000_000).nullable().optional(),
    active: z.literal(false).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'at least one field');
export type UpdatePromotionRequest = z.infer<typeof updatePromotionRequestSchema>;

export const promotionSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  productId: z.string().uuid(),
  productTitle: z.string(),
  variantId: z.string().uuid().nullable(),
  kind: promotionKindSchema,
  value: z.number().int(),
  /** Currency of the targeted variants (a fixed price is in it). */
  currency: z.string(),
  label: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  stockCap: z.number().int().nullable(),
  soldCount: z.number().int(),
  active: z.boolean(),
  status: promotionStatusSchema,
  createdAt: z.string(),
});
export type Promotion = z.infer<typeof promotionSchema>;
export const promotionListSchema = z.object({ items: z.array(promotionSchema), nextCursor: z.string().nullable() });
export type PromotionList = z.infer<typeof promotionListSchema>;
export const promotionListQuerySchema = pageQuerySchema.extend({ status: promotionStatusSchema.optional() });
export type PromotionListQuery = z.infer<typeof promotionListQuerySchema>;

/** 409 `details.reason` of the promotion routes. */
export const promotionConflictReasonSchema = z.enum(['promotion_overlap']);
