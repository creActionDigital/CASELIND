import { z } from 'zod';
import { deliveryStatusSchema } from './delivery.js';
import { orderAddressSchema } from './orders.js';

const currencySchema = z.string().regex(/^[A-Z]{3}$/);

/** Courier task: what is needed to deliver (address and phone of the buyer, cash to collect), never the proof code. */
export const courierDeliverySchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  orgId: z.uuid(),
  orgName: z.string(),
  status: deliveryStatusSchema,
  address: orderAddressSchema.nullable(),
  currency: currencySchema,
  /** Cash on delivery: amount to collect, delivery fee included. */
  totalMinor: z.number().int(),
  itemCount: z.number().int(),
  estimatedMinutes: z.number().int().nullable(),
  proofLocked: z.boolean(),
  locationSharing: z.boolean(),
  failureReason: z.string().nullable(),
  assignedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CourierDelivery = z.infer<typeof courierDeliverySchema>;

export const myDeliveryListQuerySchema = z.object({
  /** active = assigned, picked up or in transit; done = delivered, failed or returned. */
  scope: z.enum(['active', 'done', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(300).optional(),
});
export type MyDeliveryListQuery = z.infer<typeof myDeliveryListQuerySchema>;
export const myDeliveryListSchema = z.object({ items: z.array(courierDeliverySchema), nextCursor: z.string().nullable() });
export type MyDeliveryList = z.infer<typeof myDeliveryListSchema>;

