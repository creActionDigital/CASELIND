import { z } from 'zod';

/* Returns, refunds and disputes of an order (cahier 7 and 9, BACKLOG G2).
 * No money transits through CASELIND (cash on delivery only): a refund is a status and an amount
 * recorded here, "settled outside the platform". `refundMinor` is computed by the server from the
 * frozen prices of the order, never typed by the client. */

/** A return can be requested this many days after the order was delivered. */
export const RETURN_WINDOW_DAYS = 7;
export const RETURN_DETAILS_MAX = 500;
export const RETURN_NOTE_MAX = 300;

export const returnReasonSchema = z.enum(['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'other']);
export type ReturnReason = z.infer<typeof returnReasonSchema>;

export const returnStatusSchema = z.enum(['requested', 'approved', 'rejected', 'received', 'refunded', 'disputed', 'resolved', 'cancelled']);
export type ReturnStatus = z.infer<typeof returnStatusSchema>;

export const returnResolutionSchema = z.enum(['refund_buyer', 'refund_partial', 'reject']);
export type ReturnResolution = z.infer<typeof returnResolutionSchema>;

export const createReturnRequestSchema = z.object({
  reason: returnReasonSchema,
  details: z.string().trim().min(1).max(RETURN_DETAILS_MAX).optional(),
  items: z
    .array(z.object({ orderItemId: z.uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(100)
    .refine((a) => new Set(a.map((i) => i.orderItemId)).size === a.length, 'duplicate order item'),
});
export type CreateReturnRequest = z.infer<typeof createReturnRequestSchema>;

export const disputeReturnRequestSchema = z.object({ reason: z.string().trim().min(1).max(RETURN_DETAILS_MAX) });
export type DisputeReturnRequest = z.infer<typeof disputeReturnRequestSchema>;

/** Seller decision (approve / reject). */
export const returnNoteRequestSchema = z.object({ note: z.string().trim().min(1).max(RETURN_NOTE_MAX).optional() });
export type ReturnNoteRequest = z.infer<typeof returnNoteRequestSchema>;

/** Goods are back: optionally put them back in stock. */
export const returnReceivedRequestSchema = z.object({ restock: z.boolean().default(false), note: z.string().trim().min(1).max(RETURN_NOTE_MAX).optional() });
export type ReturnReceivedRequest = z.infer<typeof returnReceivedRequestSchema>;

/** The seller settled the refund outside the platform. Defaults to the amount due. */
export const returnRefundedRequestSchema = z.object({ amountMinor: z.number().int().min(0).optional(), note: z.string().trim().min(1).max(RETURN_NOTE_MAX).optional() });
export type ReturnRefundedRequest = z.infer<typeof returnRefundedRequestSchema>;

/** Platform decision. `refundMinor` is required for a partial refund (at most the amount due). */
export const resolveReturnDisputeRequestSchema = z
  .object({ resolution: returnResolutionSchema, note: z.string().trim().min(1).max(RETURN_NOTE_MAX).optional(), refundMinor: z.number().int().min(1).optional() })
  .refine((b) => (b.resolution === 'refund_partial') === (b.refundMinor !== undefined), 'refundMinor is for a partial refund only');
export type ResolveReturnDisputeRequest = z.infer<typeof resolveReturnDisputeRequestSchema>;

export const returnItemSchema = z.object({
  orderItemId: z.uuid(),
  variantId: z.uuid(),
  title: z.string(),
  unitPriceMinor: z.number().int(),
  quantity: z.number().int(),
});
export type ReturnItem = z.infer<typeof returnItemSchema>;

export const returnEventSchema = z.object({
  id: z.uuid(),
  fromStatus: returnStatusSchema.nullable(),
  status: returnStatusSchema,
  actorKind: z.enum(['buyer', 'org', 'admin']),
  createdAt: z.iso.datetime(),
});
export type ReturnEvent = z.infer<typeof returnEventSchema>;

export const orderReturnSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  orgId: z.uuid(),
  orgName: z.string(),
  requestedBy: z.uuid(),
  reason: returnReasonSchema,
  details: z.string().nullable(),
  status: returnStatusSchema,
  items: z.array(returnItemSchema),
  /** Amount due to the buyer, computed by the server (items at their frozen price, coupon share applied; delivery fee excluded). */
  refundMinor: z.number().int(),
  /** Amount the seller declared settled outside the platform. */
  refundedMinor: z.number().int().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  sellerNote: z.string().nullable(),
  resolution: returnResolutionSchema.nullable(),
  disputeReason: z.string().nullable(),
  adminNote: z.string().nullable(),
  restock: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  events: z.array(returnEventSchema),
});
export type OrderReturn = z.infer<typeof orderReturnSchema>;

/** Buyer view of an order: its returns and whether a new request can be filed now. */
export const orderReturnsSchema = z.object({
  items: z.array(orderReturnSchema),
  canRequest: z.boolean(),
  /** End of the request window (delivery + RETURN_WINDOW_DAYS); null until the order is delivered. */
  windowEndsAt: z.iso.datetime().nullable(),
});
export type OrderReturns = z.infer<typeof orderReturnsSchema>;

export const returnListQuerySchema = z.object({
  status: returnStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
export type ReturnListQuery = z.infer<typeof returnListQuerySchema>;

export const returnListSchema = z.object({ items: z.array(orderReturnSchema), nextCursor: z.string().nullable() });
export type ReturnList = z.infer<typeof returnListSchema>;

/** Admin queue: disputes to arbitrate (default) or already resolved. */
export const disputeListQuerySchema = z.object({
  status: z.enum(['disputed', 'resolved']).default('disputed'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
export type DisputeListQuery = z.infer<typeof disputeListQuerySchema>;

/** Account export: the user's returns (the free text is the user's own). */
export const exportedReturnSchema = z.object({
  orderNumber: z.string(),
  reason: returnReasonSchema,
  details: z.string().nullable(),
  status: returnStatusSchema,
  refundMinor: z.number().int(),
  currency: z.string(),
  disputeReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ExportedReturn = z.infer<typeof exportedReturnSchema>;

/** Who may move a return where (strict state machine, also used by the apps to show the right buttons). */
export type ReturnActorKind = 'buyer' | 'org' | 'admin';
export const RETURN_TRANSITIONS: Readonly<Record<ReturnActorKind, Readonly<Partial<Record<ReturnStatus, readonly ReturnStatus[]>>>>> = {
  buyer: { requested: ['cancelled'], rejected: ['disputed'] },
  // `resolved` -> `refunded` only when the platform decided in favour of the buyer (checked by the server).
  org: { requested: ['approved', 'rejected'], approved: ['received', 'refunded'], received: ['refunded'], resolved: ['refunded'] },
  admin: { disputed: ['resolved'] },
};

/** Statuses after which nothing moves any more (a refunded or cancelled return, a resolved one nobody owes). */
export const RETURN_FINAL_STATUSES: readonly ReturnStatus[] = ['refunded', 'cancelled'];
