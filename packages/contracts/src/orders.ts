import { z } from 'zod';
import { checkoutZoneChoiceSchema, deliveryViewSchema, fulfillmentSchema } from './delivery.js';

/* Lot 5B: cart, split orders, coupons, verified reviews. See docs/architecture/API_CONTRACTS.md.
 * Amounts are integers in minor units of the line's currency; no amount ever transits through CASELIND. */

export const CART_QUANTITY_MAX = 99;
export const CART_LINES_MAX = 100;
export const REVIEW_BODY_MAX = 2000;

/** Only cash on delivery exists until a payment partner is chosen (BACKLOG Q5). */
export const paymentMethodSchema = z.enum(['cash_on_delivery']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export const paymentMethodListSchema = z.object({ methods: z.array(paymentMethodSchema) });
export type PaymentMethodList = z.infer<typeof paymentMethodListSchema>;

const currencySchema = z.string().regex(/^[A-Z]{3}$/);

/* ------------------------------------------------------------------ cart */

export const setCartItemRequestSchema = z.object({
  /** 0 removes the line. */
  quantity: z.number().int().min(0).max(CART_QUANTITY_MAX),
});
export type SetCartItemRequest = z.infer<typeof setCartItemRequestSchema>;

export const cartLineSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  title: z.string(),
  variantLabel: z.string().nullable(),
  sku: z.string().nullable(),
  imageAssetId: z.uuid().nullable(),
  unitPriceMinor: z.number().int(),
  quantity: z.number().int(),
  lineTotalMinor: z.number().int(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

/** Lines of one organisation in one currency: they become one order. */
export const cartGroupSchema = z.object({
  orgId: z.uuid(),
  orgName: z.string(),
  orgSlug: z.string(),
  currency: currencySchema,
  subtotalMinor: z.number().int(),
  lines: z.array(cartLineSchema),
});
export type CartGroup = z.infer<typeof cartGroupSchema>;

export const cartSchema = z.object({
  groups: z.array(cartGroupSchema),
  /** Lines whose variant can no longer be bought (unpublished, archived, deleted): remove them to check out. */
  unavailable: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int() })),
  itemCount: z.number().int(),
});
export type Cart = z.infer<typeof cartSchema>;

/* ------------------------------------------------------------------ orders */

export const orderStatusSchema = z.enum(['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled']);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderAddressSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'expected an E.164 phone number'),
  city: z.string().trim().min(1).max(100),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().min(1).max(500).optional(),
});
export type OrderAddress = z.infer<typeof orderAddressSchema>;

export const checkoutRequestSchema = z
  .object({
    /** Idempotency key: a retry with the same clientId returns the orders already created. */
    clientId: z.uuid(),
    /** Required for a delivery; optional for a pick-up in store. */
    address: orderAddressSchema.optional(),
    paymentMethod: paymentMethodSchema,
    /** Codes are case-insensitive. A code applies to the order of the organisation that issued it. */
    couponCodes: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
    /** Lot 8: `pickup` = collected in store, free, no delivery. Default `delivery`. */
    fulfillment: fulfillmentSchema.default('delivery'),
    /** Lot 8: delivery zone per organisation. Required for an organisation that defines zones. */
    zones: z.array(checkoutZoneChoiceSchema).max(20).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillment === 'delivery' && !v.address) ctx.addIssue({ code: 'custom', path: ['address'], message: 'a delivery needs an address' });
  });
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const orderItemSchema = z.object({
  id: z.uuid(),
  variantId: z.uuid(),
  productId: z.uuid(),
  title: z.string(),
  variantLabel: z.string().nullable(),
  sku: z.string().nullable(),
  imageAssetId: z.uuid().nullable(),
  unitPriceMinor: z.number().int(),
  quantity: z.number().int(),
  lineTotalMinor: z.number().int(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: z.uuid(),
  /** Human-readable, unique: `CL-` + 8 unambiguous base32 characters. */
  number: z.string(),
  orgId: z.uuid(),
  orgName: z.string(),
  buyerId: z.uuid(),
  currency: currencySchema,
  status: orderStatusSchema,
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  /** subtotal - discount + delivery fee. */
  totalMinor: z.number().int(),
  couponCode: z.string().nullable(),
  paymentMethod: paymentMethodSchema,
  /** Lot 8. */
  fulfillment: fulfillmentSchema,
  deliveryFeeMinor: z.number().int(),
  /** Null once the buyer's account was erased. */
  address: orderAddressSchema.nullable(),
  items: z.array(orderItemSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Order = z.infer<typeof orderSchema>;

export const checkoutResponseSchema = z.object({ orders: z.array(orderSchema) });
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

export const orderEventSchema = z.object({
  id: z.uuid(),
  fromStatus: orderStatusSchema.nullable(),
  status: orderStatusSchema,
  actorKind: z.enum(['buyer', 'org', 'system']),
  actorUserId: z.uuid().nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type OrderEvent = z.infer<typeof orderEventSchema>;

export const orderDetailSchema = orderSchema.extend({
  events: z.array(orderEventSchema),
  /**
   * Buyer view only (null for the seller): the org member to open a direct conversation with
   * (`POST /v1/conversations`). Null when the buyer and that member are blocked either way.
   */
  contactUserId: z.uuid().nullable(),
  /** Lot 8: the delivery of the order (null for a pick-up). `proofCode` is filled for the buyer only. */
  delivery: deliveryViewSchema.nullable(),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const orderListQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderListSchema = z.object({ items: z.array(orderSchema), nextCursor: z.string().nullable() });
export type OrderList = z.infer<typeof orderListSchema>;

export const cancelOrderRequestSchema = z.object({ note: z.string().trim().min(1).max(500).optional() });
export type CancelOrderRequest = z.infer<typeof cancelOrderRequestSchema>;

export const updateOrderStatusRequestSchema = z.object({
  status: orderStatusSchema,
  note: z.string().trim().min(1).max(500).optional(),
});
export type UpdateOrderStatusRequest = z.infer<typeof updateOrderStatusRequestSchema>;

/** 409 details of a refused checkout reservation, and of a forbidden transition. */
export const reserveConflictDetailsSchema = z.object({
  reason: z.enum(['unavailable', 'insufficient_stock']),
  variantIds: z.array(z.uuid()),
});
export type ReserveConflictDetails = z.infer<typeof reserveConflictDetailsSchema>;

/** 400 details of an unusable coupon. */
export const couponRejectionReasonSchema = z.enum(['expired', 'exhausted', 'min_not_reached', 'not_applicable']);
export type CouponRejectionReason = z.infer<typeof couponRejectionReasonSchema>;

/* ------------------------------------------------------------------ coupons */

const COUPON_CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;

export const createCouponRequestSchema = z
  .object({
    code: z.string().regex(COUPON_CODE_RE, '3-32 letters, digits, - or _'),
    kind: z.enum(['percent', 'fixed']),
    /** percent: 1-90. fixed: minor units of `currency`. */
    value: z.number().int().min(1),
    /** Required for a fixed amount and whenever `minOrderMinor` > 0. When set, the coupon only applies to orders in this currency. */
    currency: currencySchema.optional(),
    minOrderMinor: z.number().int().min(0).default(0),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    maxUses: z.number().int().min(1).optional(),
    maxUsesPerUser: z.number().int().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'percent') {
      if (v.value > 90) ctx.addIssue({ code: 'custom', path: ['value'], message: 'a percentage is between 1 and 90' });
    } else if (!v.currency) {
      ctx.addIssue({ code: 'custom', path: ['currency'], message: 'a fixed amount needs a currency' });
    }
    if (v.minOrderMinor > 0 && !v.currency) {
      ctx.addIssue({ code: 'custom', path: ['currency'], message: 'a minimum order amount needs a currency' });
    }
    if (v.startsAt && v.endsAt && Date.parse(v.endsAt) <= Date.parse(v.startsAt)) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'endsAt must be after startsAt' });
    }
  });
export type CreateCouponRequest = z.infer<typeof createCouponRequestSchema>;

export const updateCouponRequestSchema = z.object({ active: z.literal(false) });
export type UpdateCouponRequest = z.infer<typeof updateCouponRequestSchema>;

export const couponSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  /** Upper-case. */
  code: z.string(),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().int(),
  currency: currencySchema.nullable(),
  minOrderMinor: z.number().int(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  maxUses: z.number().int().nullable(),
  maxUsesPerUser: z.number().int().nullable(),
  usesCount: z.number().int(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Coupon = z.infer<typeof couponSchema>;

export const couponListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;
export const couponListSchema = z.object({ items: z.array(couponSchema), nextCursor: z.string().nullable() });
export type CouponList = z.infer<typeof couponListSchema>;

/* ------------------------------------------------------------------ reviews */

export const createReviewRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(1).max(REVIEW_BODY_MAX).optional(),
});
export type CreateReviewRequest = z.infer<typeof createReviewRequestSchema>;

export const updateReviewRequestSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    /** null removes the text. */
    body: z.string().trim().min(1).max(REVIEW_BODY_MAX).nullable().optional(),
  })
  .refine((v) => v.rating !== undefined || v.body !== undefined, { message: 'nothing to update' });
export type UpdateReviewRequest = z.infer<typeof updateReviewRequestSchema>;

export const reviewReplyRequestSchema = z.object({ body: z.string().trim().min(1).max(REVIEW_BODY_MAX) });
export type ReviewReplyRequest = z.infer<typeof reviewReplyRequestSchema>;

export const reviewSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  rating: z.number().int(),
  body: z.string().nullable(),
  author: z.object({ userId: z.uuid(), handle: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }),
  /** Always true: only buyers of a delivered order can review. */
  verifiedPurchase: z.literal(true),
  reply: z.object({ body: z.string(), repliedAt: z.iso.datetime() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Review = z.infer<typeof reviewSchema>;

export const reviewListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

export const reviewListSchema = z.object({
  items: z.array(reviewSchema),
  nextCursor: z.string().nullable(),
  /** Over visible (non-hidden) reviews. Null average when there is none. */
  summary: z.object({
    ratingCount: z.number().int(),
    averageRating: z.number().nullable(),
    distribution: z.object({ '1': z.number().int(), '2': z.number().int(), '3': z.number().int(), '4': z.number().int(), '5': z.number().int() }),
  }),
});
export type ReviewList = z.infer<typeof reviewListSchema>;

/** GET /orgs/:orgId/reviews: reviews of all the organisation's products. `unanswered` = no seller reply yet. */
export const orgReviewListQuerySchema = reviewListQuerySchema.extend({
  status: z.enum(['all', 'unanswered']).default('all'),
});
export type OrgReviewListQuery = z.infer<typeof orgReviewListQuerySchema>;

export const orgReviewSchema = reviewSchema.extend({
  product: z.object({ id: z.uuid(), title: z.string(), imageAssetId: z.uuid().nullable() }),
});
export type OrgReview = z.infer<typeof orgReviewSchema>;

export const orgReviewListSchema = z.object({ items: z.array(orgReviewSchema), nextCursor: z.string().nullable() });
export type OrgReviewList = z.infer<typeof orgReviewListSchema>;

/* ------------------------------------------------------------------ account export */

export const exportedOrderSchema = z.object({
  number: z.string(),
  status: orderStatusSchema,
  totalMinor: z.number().int(),
  currency: currencySchema,
  createdAt: z.iso.datetime(),
  address: orderAddressSchema.nullable(),
  items: z.array(z.object({ title: z.string(), variantLabel: z.string().nullable(), quantity: z.number().int(), unitPriceMinor: z.number().int() })),
});
export type ExportedOrder = z.infer<typeof exportedOrderSchema>;

export const exportedCartItemSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int(),
  addedAt: z.iso.datetime(),
});
export type ExportedCartItem = z.infer<typeof exportedCartItemSchema>;

export const exportedReviewSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  rating: z.number().int(),
  body: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ExportedReview = z.infer<typeof exportedReviewSchema>;
