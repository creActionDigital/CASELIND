import { z } from 'zod';
import { orgKindSchema } from './orgs.js';

/**
 * Lot 7 : places (H-02). Coordinates belong to an organisation (a shop, a hotel...), never to a
 * user: CASELIND stores no user position (BACKLOG Q7, ADR-019).
 */
export const latSchema = z.number().min(-90).max(90);
export const lngSchema = z.number().min(-180).max(180);

export const orgLocationSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  label: z.string().trim().min(1).max(120).nullable(),
});
export type OrgLocation = z.infer<typeof orgLocationSchema>;

/** POST /v1/orgs/:orgId/location. */
export const setOrgLocationRequestSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
  label: z.string().trim().min(1).max(120).optional(),
});
export type SetOrgLocationRequest = z.infer<typeof setOrgLocationRequestSchema>;

/** PATCH /v1/orgs/:orgId/location: at least one field; `label: null` clears the label. */
export const updateOrgLocationRequestSchema = z
  .object({
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    label: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type UpdateOrgLocationRequest = z.infer<typeof updateOrgLocationRequestSchema>;

/** GET /v1/places: public active organisations around a point, nearest first. */
export const placesQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(50).default(10),
  kind: orgKindSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type PlacesQuery = z.infer<typeof placesQuerySchema>;

export const placeSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  kind: orgKindSchema,
  logoUrl: z.string().nullable(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  verified: z.boolean(),
  phone: z.string().nullable(),
  // 'osm' for places imported from OpenStreetMap (ODbL attribution required).
  source: z.enum(['osm']).nullable(),
  // null when the opening hours are unknown.
  openNow: z.boolean().nullable(),
  lat: latSchema,
  lng: lngSchema,
  label: z.string().nullable(),
  distanceKm: z.number().min(0),
});
export type Place = z.infer<typeof placeSchema>;

export const placeListSchema = z.object({
  items: z.array(placeSchema),
  nextCursor: z.string().nullable(),
});
export type PlaceList = z.infer<typeof placeListSchema>;
