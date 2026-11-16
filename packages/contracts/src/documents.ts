import { z } from 'zod';

/**
 * Quotes (devis) and invoices (factures) of an organisation (lot 16c, CDC §14). A record kept by the seller: no payment is taken here.
 * The total is computed on the server from the lines.
 */
export const documentKindSchema = z.enum(['quote', 'invoice']);
export type DocumentKind = z.infer<typeof documentKindSchema>;
export const documentStatusSchema = z.enum(['draft', 'sent', 'accepted', 'paid', 'cancelled']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentLineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(10_000),
  unitPriceMinor: z.number().int().min(0).max(1_000_000_000_000),
});
export type DocumentLine = z.infer<typeof documentLineSchema>;

export const createDocumentRequestSchema = z.object({
  kind: documentKindSchema,
  customerName: z.string().trim().min(1).max(120),
  customerContact: z.string().trim().max(120).default(''),
  currency: z.enum(['USD', 'CDF']),
  lines: z.array(documentLineSchema).min(1).max(50),
});
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

export const updateDocumentStatusRequestSchema = z.object({ status: documentStatusSchema });
export type UpdateDocumentStatusRequest = z.infer<typeof updateDocumentStatusRequestSchema>;

export const businessDocumentSchema = z.object({
  id: z.uuid(),
  kind: documentKindSchema,
  number: z.string(),
  customerName: z.string(),
  customerContact: z.string(),
  currency: z.string(),
  lines: z.array(documentLineSchema),
  totalMinor: z.number().int(),
  status: documentStatusSchema,
  sourceQuoteId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type BusinessDocument = z.infer<typeof businessDocumentSchema>;

export const documentListQuerySchema = z.object({ kind: documentKindSchema.optional() });
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
export const businessDocumentListSchema = z.object({ items: z.array(businessDocumentSchema) });
export type BusinessDocumentList = z.infer<typeof businessDocumentListSchema>;
