import { z } from 'zod';

/**
 * Analytique de la plateforme (CDC §26) : agrégats SQL uniquement, jamais de donnée personnelle (ni nom d'utilisateur,
 * ni client, ni contenu). Les séries sont denses : un jour sans valeur vaut 0.
 */
export const analyticsPeriodSchema = z.coerce
  .number()
  .int()
  .refine((d) => d === 7 || d === 30 || d === 90, 'days must be 7, 30 or 90');

export const analyticsQuerySchema = z.object({ days: analyticsPeriodSchema.default(30) });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const analyticsPointSchema = z.object({ day, value: z.number().int().min(0) });
export type AnalyticsPoint = z.infer<typeof analyticsPointSchema>;

const moneyDaySchema = z.object({ day, count: z.number().int().min(0), amountMinor: z.number().int().min(0) });
const currencyCode = z.string().length(3);

const moneySeriesSchema = z.object({
  currency: currencyCode,
  count: z.number().int().min(0),
  amountMinor: z.number().int().min(0),
  /** Panier moyen (montant / nombre), 0 sans vente. */
  averageMinor: z.number().int().min(0),
  byDay: z.array(moneyDaySchema),
});
export type AnalyticsMoneySeries = z.infer<typeof moneySeriesSchema>;

export const analyticsOverviewSchema = z.object({
  days: z.number().int(),
  from: day,
  to: day,
  generatedAt: z.iso.datetime(),
  users: z.object({
    total: z.number().int().min(0),
    newInPeriod: z.number().int().min(0),
    newByDay: z.array(analyticsPointSchema),
    activeByDay: z.array(analyticsPointSchema),
    /** Approximation : inscrits de la période, vieux d'au moins 7 jours, revus au moins 7 jours après l'inscription. */
    retentionD7: z.object({ cohort: z.number().int().min(0), retained: z.number().int().min(0), ratePercent: z.number().int().min(0).max(100).nullable() }),
  }),
  organizations: z.object({ total: z.number().int().min(0), verified: z.number().int().min(0), suspended: z.number().int().min(0) }),
  /** Commandes de la boutique en ligne (hors annulées), par devise. */
  orders: z.object({ byCurrency: z.array(moneySeriesSchema) }),
  /** Ventes en caisse (point de vente), par devise. */
  pos: z.object({ byCurrency: z.array(moneySeriesSchema) }),
  messages: z.object({ total: z.number().int().min(0), byDay: z.array(analyticsPointSchema) }),
  posts: z.object({ total: z.number().int().min(0), byDay: z.array(analyticsPointSchema) }),
  reports: z.object({ open: z.number().int().min(0), createdInPeriod: z.number().int().min(0), resolvedInPeriod: z.number().int().min(0) }),
  ai: z.object({ requests: z.number().int().min(0), byDay: z.array(analyticsPointSchema) }),
  /** Dix organisations au plus par devise, classées par chiffre d'affaires de la période. Nom d'organisation seulement. */
  topOrganizations: z.array(
    z.object({
      currency: currencyCode,
      items: z.array(z.object({ organizationId: z.uuid(), name: z.string(), orders: z.number().int().min(0), amountMinor: z.number().int().min(0) })),
    }),
  ),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;
