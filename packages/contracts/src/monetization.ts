import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';
import { walletModeSchema } from './wallet.js';

/* Monetisation (migration 0150) : abonnements Premium / forfaits pros et publicité payante.
 * Paiement en MODE TEST uniquement : débit du portefeuille de test par le grand livre (jamais d'argent réel), prévu pour basculer
 * plus tard vers un vrai prestataire. Montants en entiers mineurs, une devise par opération. */

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const pinSchema = z.string().min(1).max(16);
const isoSchema = z.iso.datetime();

// ---- plans et abonnements ----------------------------------------------------------------------

export const planAudienceSchema = z.enum(['user', 'org']);
export const planPeriodSchema = z.enum(['month', 'year']);
export const subscriptionPlanSchema = z.object({
  code: z.string(),
  audience: planAudienceSchema,
  period: planPeriodSchema,
  priceUsdMinor: z.number().int().min(1),
  priceCdfMinor: z.number().int().min(1),
  active: z.boolean(),
});
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;
export const subscriptionPlanListSchema = z.object({ items: z.array(subscriptionPlanSchema) });
export type SubscriptionPlanList = z.infer<typeof subscriptionPlanListSchema>;

/** Prix réglables par l'admin (PUT /admin/subscription-plans/:code). */
export const putPlanRequestSchema = z.object({
  priceUsdMinor: z.number().int().min(1).max(100_000_000),
  priceCdfMinor: z.number().int().min(1).max(100_000_000_000),
  active: z.boolean().default(true),
});
export type PutPlanRequest = z.infer<typeof putPlanRequestSchema>;

export const subscriptionStatusSchema = z.enum(['active', 'expired']);
export const subscriptionSchema = z.object({
  id: z.uuid(),
  planCode: z.string(),
  orgId: z.uuid().nullable(),
  currency: currencySchema,
  priceMinor: z.number().int(),
  /** `active` tant que la période payée n'est pas terminée (même résiliée : l'accès va jusqu'à la fin de période). */
  status: subscriptionStatusSchema,
  autoRenew: z.boolean(),
  startedAt: isoSchema,
  currentPeriodEnd: isoSchema,
  cancelledAt: isoSchema.nullable(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const subscribeRequestSchema = z.object({
  clientId: z.uuid(),
  planCode: z.string().min(1).max(40),
  currency: currencySchema,
  autoRenew: z.boolean().default(false),
  pin: pinSchema,
  /** Forfait pro : organisation concernée (payée par son portefeuille si approvisionné, sinon par le propriétaire). */
  orgId: z.uuid().optional(),
});
export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

export const renewRequestSchema = z.object({ clientId: z.uuid(), pin: pinSchema, orgId: z.uuid().optional() });
export type RenewRequest = z.infer<typeof renewRequestSchema>;

export const autoRenewRequestSchema = z.object({ autoRenew: z.boolean(), orgId: z.uuid().optional() });
export type AutoRenewRequest = z.infer<typeof autoRenewRequestSchema>;

export const subscriptionQuerySchema = z.object({ orgId: z.uuid().optional() });
export type SubscriptionQuery = z.infer<typeof subscriptionQuerySchema>;

export const subscriptionPaymentSchema = z.object({
  id: z.uuid(),
  receiptNo: z.string(),
  planCode: z.string(),
  kind: z.enum(['initial', 'renewal']),
  amountMinor: z.number().int(),
  currency: currencySchema,
  payer: z.enum(['user', 'org']),
  createdAt: isoSchema,
});
export type SubscriptionPayment = z.infer<typeof subscriptionPaymentSchema>;
export const subscriptionPaymentListSchema = z.object({ items: z.array(subscriptionPaymentSchema), nextCursor: z.string().nullable() });
export type SubscriptionPaymentList = z.infer<typeof subscriptionPaymentListSchema>;

export const subscriptionStateSchema = z.object({
  mode: walletModeSchema,
  subscription: subscriptionSchema.nullable(),
  premium: z.boolean(),
});
export type SubscriptionState = z.infer<typeof subscriptionStateSchema>;

export const subscriptionResponseSchema = z.object({
  mode: walletModeSchema,
  replayed: z.boolean(),
  subscription: subscriptionSchema,
  payment: subscriptionPaymentSchema,
  balanceMinor: z.number().int(),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export const adminSubscriptionSchema = subscriptionSchema.extend({ userId: z.uuid() });
export type AdminSubscription = z.infer<typeof adminSubscriptionSchema>;
export const adminSubscriptionsQuerySchema = pageQuerySchema.extend({ status: subscriptionStatusSchema.optional() });
export type AdminSubscriptionsQuery = z.infer<typeof adminSubscriptionsQuerySchema>;
export const adminSubscriptionListSchema = z.object({ items: z.array(adminSubscriptionSchema), nextCursor: z.string().nullable() });
export type AdminSubscriptionList = z.infer<typeof adminSubscriptionListSchema>;

// ---- publicité ---------------------------------------------------------------------------------

export const ADS_COST_PER_CLICK_USD_MINOR = 10;
export const ADS_MIN_BUDGET_USD_MINOR = 500;
export const ADS_MAX_BUDGET_USD_MINOR = 1_000_000;

export const adObjectiveSchema = z.enum(['reach', 'clicks', 'sales']);
export type AdObjective = z.infer<typeof adObjectiveSchema>;
export const adPlacementSchema = z.enum(['feed', 'videos', 'marketplace', 'search']);
export type AdPlacement = z.infer<typeof adPlacementSchema>;
export const adStatusSchema = z.enum(['pending', 'approved', 'rejected', 'paused', 'stopped', 'ended']);
export type AdStatus = z.infer<typeof adStatusSchema>;

export const adAudienceSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/).nullable().default(null),
  city: z.string().trim().min(1).max(80).nullable().default(null),
  minAge: z.number().int().min(13).max(99).nullable().default(null),
  interests: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});
export type AdAudience = z.infer<typeof adAudienceSchema>;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createAdCampaignRequestSchema = z
  .object({
    clientId: z.uuid(),
    name: z.string().trim().min(2).max(80),
    objective: adObjectiveSchema,
    postId: z.uuid().optional(),
    productId: z.uuid().optional(),
    audience: adAudienceSchema.default({ country: null, city: null, minAge: null, interests: [] }),
    placements: z.array(adPlacementSchema).min(1).max(4),
    budgetMinor: z.number().int().min(1).max(1_000_000_000_000),
    dailyBudgetMinor: z.number().int().min(1).max(1_000_000_000_000),
    currency: currencySchema,
    startsOn: dateSchema,
    endsOn: dateSchema,
    pin: pinSchema,
    orgId: z.uuid().optional(),
  })
  .refine((v) => (v.postId ? 1 : 0) + (v.productId ? 1 : 0) === 1, { message: 'exactly one of postId, productId', path: ['postId'] })
  .refine((v) => v.dailyBudgetMinor <= v.budgetMinor, { message: 'dailyBudgetMinor must not exceed budgetMinor', path: ['dailyBudgetMinor'] })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'endsOn before startsOn', path: ['endsOn'] });
export type CreateAdCampaignRequest = z.infer<typeof createAdCampaignRequestSchema>;

export const adCampaignSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  objective: adObjectiveSchema,
  postId: z.uuid().nullable(),
  productId: z.uuid().nullable(),
  orgId: z.uuid().nullable(),
  audience: adAudienceSchema,
  placements: z.array(adPlacementSchema),
  budgetMinor: z.number().int(),
  dailyBudgetMinor: z.number().int(),
  spentMinor: z.number().int(),
  refundedMinor: z.number().int(),
  currency: currencySchema,
  startsOn: dateSchema,
  endsOn: dateSchema,
  status: adStatusSchema,
  rejectionReason: z.string().nullable(),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  createdAt: isoSchema,
});
export type AdCampaign = z.infer<typeof adCampaignSchema>;
export const adCampaignListSchema = z.object({ items: z.array(adCampaignSchema), nextCursor: z.string().nullable() });
export type AdCampaignList = z.infer<typeof adCampaignListSchema>;
export const adCampaignListQuerySchema = pageQuerySchema.extend({ status: adStatusSchema.optional() });
export type AdCampaignListQuery = z.infer<typeof adCampaignListQuerySchema>;

export const adCampaignResponseSchema = z.object({
  mode: walletModeSchema,
  replayed: z.boolean(),
  campaign: adCampaignSchema,
  balanceMinor: z.number().int(),
});
export type AdCampaignResponse = z.infer<typeof adCampaignResponseSchema>;

export const adCampaignStatsSchema = z.object({
  campaign: adCampaignSchema,
  days: z.array(z.object({ date: dateSchema, impressions: z.number().int(), clicks: z.number().int(), spentMinor: z.number().int() })),
});
export type AdCampaignStats = z.infer<typeof adCampaignStatsSchema>;

export const adCampaignActionSchema = z.enum(['pause', 'resume', 'stop']);
export const adCampaignActionRequestSchema = z.object({ action: adCampaignActionSchema });
export type AdCampaignActionRequest = z.infer<typeof adCampaignActionRequestSchema>;

/** Annonce servie à un utilisateur : toujours « Sponsorisé ». */
export const servedAdSchema = z.object({
  campaignId: z.uuid(),
  sponsored: z.literal(true),
  postId: z.uuid().nullable(),
  productId: z.uuid().nullable(),
  title: z.string(),
});
export type ServedAd = z.infer<typeof servedAdSchema>;
export const servedAdListSchema = z.object({ items: z.array(servedAdSchema) });
export type ServedAdList = z.infer<typeof servedAdListSchema>;
export const serveAdsQuerySchema = z.object({ placement: adPlacementSchema, limit: z.coerce.number().int().min(1).max(5).default(2) });
export type ServeAdsQuery = z.infer<typeof serveAdsQuerySchema>;

export const adBillingSchema = z.object({
  mode: walletModeSchema,
  items: z.array(
    z.object({
      campaignId: z.uuid(),
      name: z.string(),
      kind: z.enum(['charge', 'refund']),
      amountMinor: z.number().int(),
      currency: currencySchema,
      createdAt: isoSchema,
    }),
  ),
});
export type AdBilling = z.infer<typeof adBillingSchema>;

export const adminCampaignSchema = adCampaignSchema.extend({ userId: z.uuid(), preview: z.string().nullable() });
export type AdminCampaign = z.infer<typeof adminCampaignSchema>;
export const adminCampaignListSchema = z.object({ items: z.array(adminCampaignSchema), nextCursor: z.string().nullable() });
export type AdminCampaignList = z.infer<typeof adminCampaignListSchema>;
export const adminReviewRequestSchema = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(300).optional() });
export type AdminReviewRequest = z.infer<typeof adminReviewRequestSchema>;
