import { z } from 'zod';
import { healthEntryKindSchema } from './health.js';
import { attachedFileSchema } from './media.js';
import { pageQuerySchema } from './pagination.js';

/**
 * Exam results (lot 18d, CDC §12): the patient's own results (free-text values and an optional PDF/photo of the report),
 * or added by a verified professional who has an appointment with the patient. Same rules as the rest of the record:
 * regulated `health` flag, explicit consent, content encrypted. No laboratory integration.
 */
export const HEALTH_RESULTS_MAX = 200;

export const healthResultKindSchema = z.enum(['blood', 'urine', 'imaging', 'other']);
export type HealthResultKind = z.infer<typeof healthResultKindSchema>;

/** What a share can cover: the record's entry kinds, plus the exam results. */
export const healthShareKindSchema = z.enum([...healthEntryKindSchema.options, 'results']);
export type HealthShareKind = z.infer<typeof healthShareKindSchema>;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fields = {
  kind: healthResultKindSchema,
  title: z.string().trim().min(1).max(120),
  /** Values and comments, free text. */
  summary: z.string().trim().max(2000),
  /** Date of the exam; not in the future. */
  resultDate: date,
};
/** `assetId`: a ready upload of the caller with purpose `health_result` (PDF or image, 10 MB). */
export const createHealthResultRequestSchema = z.object({ ...fields, summary: fields.summary.default(''), assetId: z.uuid().nullable().default(null) });
export type CreateHealthResultRequest = z.infer<typeof createHealthResultRequestSchema>;
/** Absent = unchanged; `assetId` null removes the file, another id replaces it (the old file is deleted). */
export const updateHealthResultRequestSchema = z.object({ ...fields, assetId: z.uuid().nullable() }).partial();
export type UpdateHealthResultRequest = z.infer<typeof updateHealthResultRequestSchema>;

export const healthResultListQuerySchema = pageQuerySchema.extend({ kind: healthResultKindSchema.optional() });
export type HealthResultListQuery = z.infer<typeof healthResultListQuerySchema>;

export const healthResultSchema = z.object({
  id: z.uuid(),
  kind: healthResultKindSchema,
  title: z.string(),
  summary: z.string(),
  resultDate: z.string(),
  /** The professional who entered it; null when the patient did. */
  provider: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  file: attachedFileSchema.nullable(),
  createdAt: z.string(),
});
export type HealthResult = z.infer<typeof healthResultSchema>;
export const healthResultListSchema = z.object({ items: z.array(healthResultSchema), nextCursor: z.string().nullable() });
export type HealthResultList = z.infer<typeof healthResultListSchema>;

/** A patient's results as a professional reads them (active share covering `results`). Logged for the patient. */
export const sharedResultsSchema = z.object({
  patient: z.object({ id: z.uuid(), displayName: z.string() }),
  expiresAt: z.string(),
  items: z.array(healthResultSchema),
});
export type SharedResults = z.infer<typeof sharedResultsSchema>;
