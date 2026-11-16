import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** Lot 17e (CDC §13): school search and scholarships. Public school fields only: never classes, pupils or announcements. */
export const schoolSearchQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(80).optional(),
});
export type SchoolSearchQuery = z.infer<typeof schoolSearchQuerySchema>;

export const schoolSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  logoUrl: z.string().nullable(),
  verified: z.boolean(),
});
export type SchoolSummary = z.infer<typeof schoolSummarySchema>;
export const schoolSummaryListSchema = z.object({ items: z.array(schoolSummarySchema), nextCursor: z.string().nullable() });
export type SchoolSummaryList = z.infer<typeof schoolSummaryListSchema>;

export const createScholarshipRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  deadline: z.iso.date().optional(),
  url: z.string().trim().max(500).regex(/^https:\/\/\S+$/, 'https only').optional(),
});
export type CreateScholarshipRequest = z.infer<typeof createScholarshipRequestSchema>;

/** Lot 17g: partial edit of an open scholarship (at least one field). */
export const updateScholarshipRequestSchema = createScholarshipRequestSchema.partial().refine((b) => Object.keys(b).length > 0, 'at least one field');
export type UpdateScholarshipRequest = z.infer<typeof updateScholarshipRequestSchema>;

export const scholarshipListQuerySchema = pageQuerySchema.extend({ city: z.string().trim().max(80).optional() });
export type ScholarshipListQuery = z.infer<typeof scholarshipListQuerySchema>;

export const scholarshipSchema = z.object({
  id: z.uuid(),
  school: z.object({ id: z.uuid(), slug: z.string(), name: z.string(), city: z.string().nullable(), verified: z.boolean() }),
  title: z.string(),
  description: z.string(),
  deadline: z.string().nullable(),
  url: z.string().nullable(),
  status: z.enum(['open', 'closed']),
  createdAt: z.string(),
});
export type Scholarship = z.infer<typeof scholarshipSchema>;
export const scholarshipListSchema = z.object({ items: z.array(scholarshipSchema), nextCursor: z.string().nullable() });
export type ScholarshipList = z.infer<typeof scholarshipListSchema>;
