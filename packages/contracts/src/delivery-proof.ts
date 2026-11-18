import { z } from 'zod';
import { attachedFileSchema } from './media.js';

/* Lot 8 (audit G5): proof of delivery by photo and/or customer signature, a complement to the proof code.
 * The signature is a PNG drawn on the courier's phone. Both are `delivery_proof` uploads. */

export const deliveryProofKindSchema = z.enum(['photo', 'signature']);
export type DeliveryProofKind = z.infer<typeof deliveryProofKindSchema>;

/** PUT /deliveries/:id/proof: a key set to an upload id replaces that file, null removes it, an absent key leaves it. At least one key. */
export const setDeliveryProofRequestSchema = z
  .object({ photoAssetId: z.uuid().nullable().optional(), signatureAssetId: z.uuid().nullable().optional() })
  .refine((b) => b.photoAssetId !== undefined || b.signatureAssetId !== undefined, { message: 'photoAssetId or signatureAssetId is required' });
export type SetDeliveryProofRequest = z.infer<typeof setDeliveryProofRequestSchema>;

export const deliveryProofFileSchema = attachedFileSchema.extend({ takenAt: z.iso.datetime() });
export type DeliveryProofFile = z.infer<typeof deliveryProofFileSchema>;

export const deliveryProofSchema = z.object({
  deliveryId: z.uuid(),
  photo: deliveryProofFileSchema.nullable(),
  signature: deliveryProofFileSchema.nullable(),
});
export type DeliveryProof = z.infer<typeof deliveryProofSchema>;

/** Account export: that a proof exists (kind, size, date), never the file. */
export const exportedDeliveryProofSchema = z.object({ kind: deliveryProofKindSchema, sizeBytes: z.number().int().nonnegative(), takenAt: z.iso.datetime() });
export type ExportedDeliveryProof = z.infer<typeof exportedDeliveryProofSchema>;
