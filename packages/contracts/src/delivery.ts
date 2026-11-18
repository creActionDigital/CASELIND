import { z } from 'zod';
import { exportedDeliveryProofSchema } from './delivery-proof.js';

/* Lot 8: delivery. Zones and fees per organisation, one delivery per order to deliver, proof by code,
 * optional courier position. No external carrier is wired: couriers are members of the organisation.
 * Amounts are integers in minor units. See docs/architecture/API_CONTRACTS.md, section "Lot 8". */

export const PROOF_CODE_LENGTH = 6;
export const PROOF_MAX_ATTEMPTS = 5;
export const DELIVERY_ZONES_PER_ORG_MAX = 50;

const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const fulfillmentSchema = z.enum(['delivery', 'pickup']);
export type Fulfillment = z.infer<typeof fulfillmentSchema>;

export const deliveryStatusSchema = z.enum(['pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned']);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/* ------------------------------------------------------------------ zones */

export const deliveryZoneFeesSchema = z
  .record(currencySchema, z.number().int().min(0).max(1_000_000_000))
  .refine((v) => Object.keys(v).length >= 1 && Object.keys(v).length <= 10, { message: 'between 1 and 10 currencies' });

export const createDeliveryZoneRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Cities or neighbourhoods covered; matched case- and accent-insensitively against the order address city or second line. */
  areas: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  /** Fee per currency, in minor units. A zone cannot be used for an order whose currency has no fee. */
  fees: deliveryZoneFeesSchema,
  etaMinutes: z.number().int().min(5).max(20160),
  active: z.boolean().default(true),
});
export type CreateDeliveryZoneRequest = z.infer<typeof createDeliveryZoneRequestSchema>;

export const updateDeliveryZoneRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    areas: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
    fees: deliveryZoneFeesSchema,
    etaMinutes: z.number().int().min(5).max(20160),
    active: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateDeliveryZoneRequest = z.infer<typeof updateDeliveryZoneRequestSchema>;

export const deliveryZoneSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  name: z.string(),
  areas: z.array(z.string()),
  fees: z.record(z.string(), z.number().int()),
  etaMinutes: z.number().int(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DeliveryZone = z.infer<typeof deliveryZoneSchema>;
export const deliveryZoneListSchema = z.object({ items: z.array(deliveryZoneSchema) });
export type DeliveryZoneList = z.infer<typeof deliveryZoneListSchema>;

/** Checkout: the zone chosen for the order of one organisation. */
export const checkoutZoneChoiceSchema = z.object({ orgId: z.uuid(), zoneId: z.uuid() });
export type CheckoutZoneChoice = z.infer<typeof checkoutZoneChoiceSchema>;

/* ------------------------------------------------------------------ deliveries */

export const deliveryCourierSchema = z.object({ userId: z.uuid(), handle: z.string(), displayName: z.string() });
export type DeliveryCourier = z.infer<typeof deliveryCourierSchema>;

export const deliveryLocationSchema = z.object({ lat: z.number(), lng: z.number(), updatedAt: z.iso.datetime() });
export type DeliveryLocation = z.infer<typeof deliveryLocationSchema>;

/**
 * Delivery as seen by the buyer (with `proofCode`, and the last courier position while in transit),
 * the seller (neither) and the order detail. `proofCode` is null once the delivery is over.
 */
export const deliveryViewSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  orgId: z.uuid(),
  status: deliveryStatusSchema,
  courier: deliveryCourierSchema.nullable(),
  estimatedMinutes: z.number().int().nullable(),
  /** Buyer only: the 6-digit code to give to the courier on arrival. */
  proofCode: z.string().nullable(),
  /** True after 5 wrong codes: the seller must reset it. */
  proofLocked: z.boolean(),
  /** Buyer only, in transit only, last position only. */
  location: deliveryLocationSchema.nullable(),
  locationSharing: z.boolean(),
  failureReason: z.string().nullable(),
  rating: z.number().int().nullable(),
  assignedAt: z.iso.datetime().nullable(),
  pickedUpAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DeliveryView = z.infer<typeof deliveryViewSchema>;

export const deliveryEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['status', 'assignment', 'incident', 'proof']),
  fromStatus: deliveryStatusSchema.nullable(),
  status: deliveryStatusSchema,
  actorKind: z.enum(['buyer', 'org', 'courier', 'system']),
  actorUserId: z.uuid().nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;

export const deliveryDetailSchema = deliveryViewSchema.extend({ events: z.array(deliveryEventSchema) });
export type DeliveryDetail = z.infer<typeof deliveryDetailSchema>;

export const deliveryListQuerySchema = z.object({
  status: deliveryStatusSchema.optional(),
  courierUserId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
export type DeliveryListQuery = z.infer<typeof deliveryListQuerySchema>;
export const deliveryListSchema = z.object({ items: z.array(deliveryViewSchema), nextCursor: z.string().nullable() });
export type DeliveryList = z.infer<typeof deliveryListSchema>;

/* ------------------------------------------------------------------ requests */

/** The assignee is an active member with the `delivery` role, or the caller themselves. Reassignable until picked up. */
export const assignDeliveryRequestSchema = z.object({ courierUserId: z.uuid() });
export type AssignDeliveryRequest = z.infer<typeof assignDeliveryRequestSchema>;

export const courierDeliveryStatusRequestSchema = z
  .object({
    status: z.enum(['picked_up', 'in_transit', 'delivered', 'failed', 'returned']),
    /** delivered: the buyer's 6-digit code (5 attempts, then locked). */
    code: z.string().regex(/^\d{6}$/, 'expected 6 digits').optional(),
    /** failed: required. */
    reason: z.string().trim().min(1).max(500).optional(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'delivered' && !v.code) ctx.addIssue({ code: 'custom', path: ['code'], message: 'the delivery code is required' });
    if (v.status === 'failed' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'a reason is required' });
  });
export type CourierDeliveryStatusRequest = z.infer<typeof courierDeliveryStatusRequestSchema>;

/** Seller side: give up on a delivery (before it is delivered) or record that the goods came back. */
export const orgDeliveryStatusRequestSchema = z.object({
  status: z.enum(['failed', 'returned']),
  reason: z.string().trim().min(1).max(500),
});
export type OrgDeliveryStatusRequest = z.infer<typeof orgDeliveryStatusRequestSchema>;

export const deliveryIncidentRequestSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type DeliveryIncidentRequest = z.infer<typeof deliveryIncidentRequestSchema>;

export const locationConsentRequestSchema = z.object({ granted: z.boolean() });
export type LocationConsentRequest = z.infer<typeof locationConsentRequestSchema>;

export const courierLocationRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type CourierLocationRequest = z.infer<typeof courierLocationRequestSchema>;

export const rateDeliveryRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(500).optional(),
});
export type RateDeliveryRequest = z.infer<typeof rateDeliveryRequestSchema>;

/** Realtime payload `delivery.location` (room of the order, buyer only). Nothing is stored beyond the last position. */
export const deliveryLocationEventSchema = z.object({
  orderId: z.uuid(),
  deliveryId: z.uuid(),
  lat: z.number(),
  lng: z.number(),
  updatedAt: z.iso.datetime(),
});
export type DeliveryLocationEvent = z.infer<typeof deliveryLocationEventSchema>;

/* ------------------------------------------------------------------ account export */

export const exportedDeliverySchema = z.object({
  orderNumber: z.string(),
  /** buyer: delivery of one of the user's orders. courier: delivery the user carried. */
  role: z.enum(['buyer', 'courier']),
  status: deliveryStatusSchema,
  /** The rating the buyer gave (buyer role) or received (courier role). */
  rating: z.number().int().nullable(),
  ratingComment: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  deliveredAt: z.iso.datetime().nullable(),
  /** Photo / signature proofs attached to the delivery (existence only, never the file). */
  proofs: z.array(exportedDeliveryProofSchema),
});
export type ExportedDelivery = z.infer<typeof exportedDeliverySchema>;
