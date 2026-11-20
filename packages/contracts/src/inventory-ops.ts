import { z } from 'zod';
import { calendarDateSchema } from './hr.js';

/**
 * Lots, péremption et inventaire physique (CDC §8). Miroir de la migration 0085.
 * Les lots sont un COMPLÉMENT d'information : ils ne changent ni la réservation ni le stock (sauf `enterStock` à la création
 * et l'application d'un inventaire, qui passent par des mouvements de stock typés).
 */

export const BATCHES_PER_VARIANT_MAX = 200;
export const COUNT_LINES_PER_REQUEST_MAX = 200;
export const EXPIRY_SOON_DAYS = 7;

const optNote = z.string().trim().min(1).max(100).nullish();

export const createBatchRequestSchema = z.object({
  batchCode: z.string().trim().min(1).max(40),
  expiresOn: calendarDateSchema.nullish(),
  quantity: z.number().int().min(1).max(1_000_000),
  receivedOn: calendarDateSchema.optional(),
  note: optNote,
  /** Entre aussi la quantité en stock (mouvement « restock », même transaction). */
  enterStock: z.boolean().default(false),
});
export type CreateBatchRequest = z.infer<typeof createBatchRequestSchema>;

export const patchBatchRequestSchema = z
  .object({
    batchCode: z.string().trim().min(1).max(40),
    expiresOn: calendarDateSchema.nullable(),
    quantityRemaining: z.number().int().min(0).max(1_000_000),
    note: optNote,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'at least one field');
export type PatchBatchRequest = z.infer<typeof patchBatchRequestSchema>;

/** Bascule d'information : n'agit PAS sur le stock de la variante. */
export const consumeBatchRequestSchema = z.object({ quantity: z.number().int().min(1).max(1_000_000) });
export type ConsumeBatchRequest = z.infer<typeof consumeBatchRequestSchema>;

export const batchSchema = z.object({
  id: z.uuid(),
  variantId: z.uuid(),
  batchCode: z.string(),
  expiresOn: z.string().nullable(),
  quantityReceived: z.number().int(),
  quantityRemaining: z.number().int(),
  receivedOn: z.string(),
  note: z.string().nullable(),
  /** Calculés par le serveur à la date du jour (UTC). */
  expired: z.boolean(),
  daysToExpiry: z.number().int().nullable(),
});
export type Batch = z.infer<typeof batchSchema>;
export const batchListSchema = z.object({ items: z.array(batchSchema) });
export type BatchList = z.infer<typeof batchListSchema>;

export const fefoQuerySchema = z.object({ quantity: z.coerce.number().int().min(1).max(1_000_000).optional() });
export type FefoQuery = z.infer<typeof fefoQuerySchema>;
export const fefoSchema = z.object({
  /** Lots non vides par péremption croissante (sans date en dernier). */
  items: z.array(batchSchema),
  /** Répartition suggérée de `quantity` (lots périmés exclus), null sans `quantity`. */
  plan: z.array(z.object({ batchId: z.uuid(), batchCode: z.string(), take: z.number().int() })).nullable(),
  shortfall: z.number().int().nullable(),
});
export type Fefo = z.infer<typeof fefoSchema>;

export const expiringQuerySchema = z.object({ days: z.coerce.number().int().min(0).max(365).default(30) });
export type ExpiringQuery = z.infer<typeof expiringQuerySchema>;
export const expiringBatchSchema = batchSchema.extend({ sku: z.string(), productTitle: z.string() });
export type ExpiringBatch = z.infer<typeof expiringBatchSchema>;
export const expiringListSchema = z.object({ items: z.array(expiringBatchSchema) });
export type ExpiringList = z.infer<typeof expiringListSchema>;

// ---- inventaire physique ----------------------------------------------------------------

export const inventoryCountStatusSchema = z.enum(['open', 'closed', 'cancelled']);
export type InventoryCountStatus = z.infer<typeof inventoryCountStatusSchema>;

export const openInventoryCountRequestSchema = z.object({ note: z.string().trim().min(1).max(200).nullish() });
export type OpenInventoryCountRequest = z.infer<typeof openInventoryCountRequestSchema>;

export const putCountLinesRequestSchema = z
  .object({
    lines: z
      .array(z.object({ variantId: z.uuid(), countedQuantity: z.number().int().min(0).max(1_000_000) }))
      .min(1)
      .max(COUNT_LINES_PER_REQUEST_MAX),
  })
  .refine((b) => new Set(b.lines.map((l) => l.variantId.toLowerCase())).size === b.lines.length, 'duplicate variantId');
export type PutCountLinesRequest = z.infer<typeof putCountLinesRequestSchema>;

export const closeInventoryCountRequestSchema = z.object({ apply: z.boolean() });
export type CloseInventoryCountRequest = z.infer<typeof closeInventoryCountRequestSchema>;

export const inventoryCountSchema = z.object({
  id: z.uuid(),
  status: inventoryCountStatusSchema,
  openedBy: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
  /** Clôturé avec application : un mouvement « adjustment » par écart. */
  applied: z.boolean(),
});
export type InventoryCount = z.infer<typeof inventoryCountSchema>;

export const inventoryCountLineSchema = z.object({
  variantId: z.uuid(),
  sku: z.string(),
  productTitle: z.string(),
  countedQuantity: z.number().int(),
  /** Stock du système figé à l'ajout de la ligne. */
  systemQuantity: z.number().int(),
  /** Écart = compté - système (calculé par le serveur). */
  variance: z.number().int(),
  countedBy: z.string().nullable(),
});
export type InventoryCountLine = z.infer<typeof inventoryCountLineSchema>;

export const inventoryCountDetailSchema = inventoryCountSchema.extend({
  lines: z.array(inventoryCountLineSchema),
  lineCount: z.number().int(),
  discrepancyCount: z.number().int(),
  netVariance: z.number().int(),
});
export type InventoryCountDetail = z.infer<typeof inventoryCountDetailSchema>;

export const inventoryCountListSchema = z.object({ items: z.array(inventoryCountSchema) });
export type InventoryCountList = z.infer<typeof inventoryCountListSchema>;
