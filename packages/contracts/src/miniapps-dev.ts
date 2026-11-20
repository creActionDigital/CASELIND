import { z } from 'zod';
import { miniappScopeSchema, MINIAPP_SCOPES } from './miniapps.js';

/* Plateforme développeurs : versions, statistiques d'usage, quotas et activité des applications (cahier §23, écart G3). */

/** semver strict MAJEUR.MINEUR.CORRECTIF (pas de pré-version). */
export const miniappSemverSchema = z.string().trim().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/, 'a version like 1.2.3 is required');

export const miniappVersionStatusSchema = z.enum(['draft', 'submitted', 'approved', 'rejected', 'superseded']);
export type MiniAppVersionStatus = z.infer<typeof miniappVersionStatusSchema>;

export const createMiniAppVersionRequestSchema = z.object({
  version: miniappSemverSchema,
  changelog: z.string().trim().max(1000).nullable().optional(),
  /** Ensemble complet des scopes de cette version, figé à la création ; absent = scopes actuels de l'application. */
  scopes: z
    .array(miniappScopeSchema)
    .max(MINIAPP_SCOPES.length)
    .refine((a) => new Set(a).size === a.length, 'duplicate scope')
    .optional(),
  /** Manifeste de cette version ; absent = manifeste actuel de l'application (la soumission exige un manifeste complet). */
  manifest: z.unknown().optional(),
});
export type CreateMiniAppVersionRequest = z.infer<typeof createMiniAppVersionRequestSchema>;

export const miniappVersionSchema = z.object({
  id: z.uuid(),
  appId: z.uuid(),
  version: z.string(),
  changelog: z.string().nullable(),
  scopes: z.array(miniappScopeSchema),
  /** Scopes absents de la version courante : leur approbation exige un nouveau consentement des utilisateurs. */
  addedScopes: z.array(miniappScopeSchema),
  /** Manifeste fige de la version (null tant qu'aucun n'est fourni). */
  manifest: z.unknown().nullable().optional(),
  /** Vrai quand l'approbation exigera un nouveau consentement (scopes, donnees, couts ou lieu des donnees). */
  needsReconsent: z.boolean().optional(),
  status: miniappVersionStatusSchema,
  reviewNote: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type MiniAppVersion = z.infer<typeof miniappVersionSchema>;
export const miniappVersionListSchema = z.object({ items: z.array(miniappVersionSchema), nextCursor: z.string().nullable() });
export type MiniAppVersionList = z.infer<typeof miniappVersionListSchema>;

export const miniappVersionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type MiniAppVersionListQuery = z.infer<typeof miniappVersionListQuerySchema>;

export const adminMiniAppVersionListQuerySchema = miniappVersionListQuerySchema.extend({
  status: miniappVersionStatusSchema.default('submitted'),
});
export type AdminMiniAppVersionListQuery = z.infer<typeof adminMiniAppVersionListQuerySchema>;

export const reviewMiniAppVersionRequestSchema = z.object({ note: z.string().trim().min(1).max(500).optional() });
export type ReviewMiniAppVersionRequest = z.infer<typeof reviewMiniAppVersionRequestSchema>;

/* ------------------------------------------------------------------ quotas */

export const miniappQuotaSchema = z.object({
  perMinute: z.number().int(),
  perDay: z.number().int(),
  /** Vrai quand le quota par minute est une surcharge de l'administrateur. */
  overridden: z.boolean(),
});
export type MiniAppQuota = z.infer<typeof miniappQuotaSchema>;

/** `null` rétablit la valeur par défaut de la plateforme. */
export const setMiniAppQuotaRequestSchema = z.object({ rateLimitPerMinute: z.number().int().min(1).max(100_000).nullable() });
export type SetMiniAppQuotaRequest = z.infer<typeof setMiniAppQuotaRequestSchema>;

/* ------------------------------------------------------------------ statistiques */

export const miniappStatsQuerySchema = z.object({
  days: z.union([z.literal('7'), z.literal('30'), z.literal('90')]).default('30').transform((v) => Number(v) as 7 | 30 | 90),
});
export type MiniAppStatsQuery = z.infer<typeof miniappStatsQuerySchema>;

export const miniappUsageDaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  authorizations: z.number().int(),
  activeUsers: z.number().int(),
  apiCalls: z.number().int(),
  paymentRequests: z.number().int(),
  paymentsConfirmed: z.number().int(),
  errors: z.number().int(),
});
export type MiniAppUsageDay = z.infer<typeof miniappUsageDaySchema>;

export const miniappStatsSchema = z.object({
  days: z.number().int(),
  /** Série dense, du plus ancien au plus récent, jours UTC. */
  items: z.array(miniappUsageDaySchema),
  /** Les utilisateurs actifs ne s'additionnent pas d'un jour à l'autre : ils ne figurent pas dans les totaux. */
  totals: z.object({
    authorizations: z.number().int(),
    apiCalls: z.number().int(),
    paymentRequests: z.number().int(),
    paymentsConfirmed: z.number().int(),
    errors: z.number().int(),
  }),
  quota: miniappQuotaSchema,
});
export type MiniAppStats = z.infer<typeof miniappStatsSchema>;

/* ------------------------------------------------------------------ activité vue par l'utilisateur (écart G3) */

export const MINIAPP_ACCESS_RESOURCES = ['profile', 'orders', 'payment', 'notification'] as const;
export const miniappAccessResourceSchema = z.enum(MINIAPP_ACCESS_RESOURCES);
export type MiniAppAccessResource = z.infer<typeof miniappAccessResourceSchema>;

export const miniappActivityItemSchema = z.object({
  id: z.uuid(),
  scope: z.string(),
  resource: miniappAccessResourceSchema,
  at: z.iso.datetime(),
});
export type MiniAppActivityItem = z.infer<typeof miniappActivityItemSchema>;
export const miniappActivityListSchema = z.object({ items: z.array(miniappActivityItemSchema), nextCursor: z.string().nullable() });
export type MiniAppActivityList = z.infer<typeof miniappActivityListSchema>;

/** Rubrique de l'export de compte : date, scope et application, jamais le contenu lu. */
export const exportedMiniAppAccessSchema = z.object({
  appId: z.uuid(),
  appName: z.string(),
  scope: z.string(),
  at: z.iso.datetime(),
});
export type ExportedMiniAppAccess = z.infer<typeof exportedMiniAppAccessSchema>;
