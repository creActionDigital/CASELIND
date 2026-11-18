import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** Actualites d'une organisation (CDC §5) : publications, promotions et evenements de la vitrine. */
export const ORG_UPDATES_MAX = 50;

export const orgUpdateKindSchema = z.enum(['post', 'promo', 'event']);
export type OrgUpdateKind = z.infer<typeof orgUpdateKindSchema>;

const instant = z.iso.datetime({ offset: true });

/** Un evenement exige `startsAt`, et `endsAt` est apres `startsAt` : verifie par le serveur (400). */
export const createOrgUpdateRequestSchema = z.object({
  kind: orgUpdateKindSchema,
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(1000),
  startsAt: instant.nullable().optional(),
  endsAt: instant.nullable().optional(),
  place: z.string().trim().min(1).max(120).nullable().optional(),
});
export type CreateOrgUpdateRequest = z.infer<typeof createOrgUpdateRequestSchema>;

export const updateOrgUpdateRequestSchema = createOrgUpdateRequestSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'at least one field');
export type UpdateOrgUpdateRequest = z.infer<typeof updateOrgUpdateRequestSchema>;

export const orgUpdateSchema = z.object({
  id: z.uuid(),
  kind: orgUpdateKindSchema,
  title: z.string(),
  body: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  place: z.string().nullable(),
  /** Masquee par la moderation : visible des seuls membres. */
  hidden: z.boolean(),
  createdAt: z.string(),
});
export type OrgUpdate = z.infer<typeof orgUpdateSchema>;

export const orgUpdateListQuerySchema = pageQuerySchema;
export type OrgUpdateListQuery = z.infer<typeof orgUpdateListQuerySchema>;

export const orgUpdateListSchema = z.object({ items: z.array(orgUpdateSchema), nextCursor: z.string().nullable() });
export type OrgUpdateList = z.infer<typeof orgUpdateListSchema>;
