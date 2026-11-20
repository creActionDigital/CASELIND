import { z } from 'zod';
import { searchOrgHitSchema, searchProductHitSchema } from './search.js';
import { orgKindSchema } from './orgs.js';

/** Natural-language search (CDC section 22): a phrase becomes validated filters, which the existing search runs. */
export const NATURAL_CATEGORY_SLUGS = ['alimentation', 'mode', 'beaute', 'electronique', 'maison', 'sante', 'bebe', 'sport', 'auto-moto', 'services'] as const;
export const naturalCategorySchema = z.enum(NATURAL_CATEGORY_SLUGS);

export const NATURAL_QUERY_MAX = 200;

export const naturalQuerySchema = z.object({ q: z.string().trim().min(2).max(NATURAL_QUERY_MAX) });
export type NaturalQuery = z.infer<typeof naturalQuerySchema>;

/** Structured filters. Prices are in minor units; `categorySlug` only applies when there is no keyword. */
export const naturalFiltersSchema = z.object({
  keywords: z.string().trim().min(1).max(100).nullable(),
  categorySlug: naturalCategorySchema.nullable(),
  minPriceMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  maxPriceMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  city: z.string().trim().min(1).max(60).nullable(),
  placeKind: orgKindSchema.nullable(),
  /** "pas cher", "cheap": cheapest first. */
  cheapFirst: z.boolean(),
  /** "pres de moi": needs a position the app does not send here; shown to the user, not applied. */
  nearMe: z.boolean(),
});
export type NaturalFilters = z.infer<typeof naturalFiltersSchema>;

/** What the model may refine (every field optional; anything else makes the answer invalid). */
export const naturalRefinementSchema = naturalFiltersSchema.omit({ nearMe: true, cheapFirst: true }).partial().strict();
export type NaturalRefinement = z.infer<typeof naturalRefinementSchema>;

export const naturalSearchResultSchema = z.object({
  interpretation: z.object({ filters: naturalFiltersSchema, refinedByAi: z.boolean() }),
  results: z.object({
    products: z.array(searchProductHitSchema),
    places: z.array(searchOrgHitSchema),
  }),
});
export type NaturalSearchResult = z.infer<typeof naturalSearchResultSchema>;

/** POST /v1/search/natural/filters: re-run with filters edited by the user (chips); no model involved. */
export const naturalFiltersRequestSchema = z.object({ filters: naturalFiltersSchema });
export type NaturalFiltersRequest = z.infer<typeof naturalFiltersRequestSchema>;
