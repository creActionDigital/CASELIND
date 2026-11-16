import { z } from 'zod';

/* Lot 16h: loyalty points (a counter: no monetary value, not transferable, not redeemable) and marketing campaigns. */

export const LOYALTY_CURRENCIES = ['USD', 'CDF'] as const;
export const loyaltyCurrencySchema = z.enum(LOYALTY_CURRENCIES);

export const updateLoyaltyProgramRequestSchema = z.object({
  enabled: z.boolean(),
  /** Whole points earned per 1 major unit of the reference currency (1 to 100). */
  pointsPerUnit: z.number().int().min(1).max(100),
  currency: loyaltyCurrencySchema,
  /** Free text defined by the shop; never a promise of money. */
  rewardText: z.string().trim().max(200),
});
export type UpdateLoyaltyProgramRequest = z.infer<typeof updateLoyaltyProgramRequestSchema>;

export const loyaltyProgramSchema = updateLoyaltyProgramRequestSchema.extend({
  members: z.number().int(),
  pointsIssued: z.number().int(),
});
export type LoyaltyProgram = z.infer<typeof loyaltyProgramSchema>;

export const myLoyaltySchema = z.object({
  marketingConsent: z.boolean(),
  items: z.array(
    z.object({
      orgId: z.uuid(),
      orgName: z.string(),
      points: z.number().int(),
      rewardText: z.string(),
      enabled: z.boolean(),
    }),
  ),
});
export type MyLoyalty = z.infer<typeof myLoyaltySchema>;

export const marketingConsentRequestSchema = z.object({ optIn: z.boolean() });
export type MarketingConsentRequest = z.infer<typeof marketingConsentRequestSchema>;
export const marketingConsentSchema = z.object({ marketingConsent: z.boolean() });

export const CAMPAIGN_TITLE_MAX = 80;
export const CAMPAIGN_BODY_MAX = 300;
export const createCampaignRequestSchema = z.object({
  title: z.string().trim().min(1).max(CAMPAIGN_TITLE_MAX),
  body: z.string().trim().min(1).max(CAMPAIGN_BODY_MAX),
});
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;

export const campaignSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  recipients: z.number().int(),
  createdAt: z.string(),
});
export type Campaign = z.infer<typeof campaignSchema>;
export const campaignListSchema = z.object({ items: z.array(campaignSchema) });
export type CampaignList = z.infer<typeof campaignListSchema>;
