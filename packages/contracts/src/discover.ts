import { z } from 'zod';

// Module « Accueil » : profils et commerçants recommandés.

export const recommendedPersonSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  followersCount: z.number().int().min(0),
  /** Personnes que vous suivez et qui suivent aussi ce profil. */
  mutualCount: z.number().int().min(0),
});
export type RecommendedPerson = z.infer<typeof recommendedPersonSchema>;
export const recommendedPeopleSchema = z.object({ items: z.array(recommendedPersonSchema) });
export type RecommendedPeople = z.infer<typeof recommendedPeopleSchema>;

export const recommendedMerchantSchema = z.object({
  orgId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  kind: z.string(),
  logoUrl: z.string().nullable(),
  city: z.string().nullable(),
  verified: z.boolean(),
});
export type RecommendedMerchant = z.infer<typeof recommendedMerchantSchema>;
export const recommendedMerchantsSchema = z.object({ items: z.array(recommendedMerchantSchema) });
export type RecommendedMerchants = z.infer<typeof recommendedMerchantsSchema>;

export const discoverQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(30).default(10) });
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
