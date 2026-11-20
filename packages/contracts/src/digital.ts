import { z } from 'zod';
import { attachedFileSchema } from './media.js';

/** PUT /orgs/{orgId}/products/{productId}/files : les fichiers vendus avec le produit (5 au plus ; liste vide = produit non numerique). */
export const setProductFilesRequestSchema = z.object({ assetIds: z.array(z.uuid()).max(5) });
export type SetProductFilesRequest = z.infer<typeof setProductFilesRequestSchema>;
export const productFilesSchema = z.object({ items: z.array(attachedFileSchema) });
export type ProductFiles = z.infer<typeof productFilesSchema>;

/** GET /me/downloads : fichiers des produits numeriques d'une commande livree. */
export const downloadSchema = z.object({
  orderId: z.uuid(),
  productId: z.uuid(),
  title: z.string(),
  deliveredAt: z.iso.datetime(),
  files: z.array(attachedFileSchema),
});
export type Download = z.infer<typeof downloadSchema>;
export const downloadListSchema = z.object({ items: z.array(downloadSchema) });
export type DownloadList = z.infer<typeof downloadListSchema>;
