import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';
import { walletModeSchema } from './wallet.js';

/* Outils createurs (migrations/0086 et 0087) : favoris, hashtags, portee, pourboires et publications sponsorisees.
 * Les montants sont de l'argent FICTIF du portefeuille de test (mode 'sandbox'), jamais de l'argent reel. */

export const BOOKMARKS_MAX = 1000;
export const HASHTAGS_PER_POST_MAX = 10;
export const HASHTAG_MAX_LENGTH = 40;
export const IMPRESSIONS_BATCH_MAX = 50;
export const BOOST_DAYS_MAX = 14;

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const amountSchema = z.number().int().min(1).max(1_000_000_000_000);

// ---- hashtags --------------------------------------------------------------------------------

export const trendingHashtagsQuerySchema = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) });
export type TrendingHashtagsQuery = z.infer<typeof trendingHashtagsQuerySchema>;

export const hashtagSuggestQuerySchema = z.object({ q: z.string().trim().min(1).max(HASHTAG_MAX_LENGTH + 1) });
export type HashtagSuggestQuery = z.infer<typeof hashtagSuggestQuerySchema>;

export const hashtagCountSchema = z.object({ tag: z.string(), postsCount: z.number().int().min(0) });
export type HashtagCount = z.infer<typeof hashtagCountSchema>;
export const hashtagListSchema = z.object({ hours: z.number().int(), items: z.array(hashtagCountSchema) });
export type HashtagList = z.infer<typeof hashtagListSchema>;

/** GET /v1/creators/popular : comptes actifs les plus suivis (hors moi et blocages), avec leurs compteurs. */
export const popularCreatorSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  followersCount: z.number().int().min(0),
  postsCount: z.number().int().min(0),
});
export type PopularCreator = z.infer<typeof popularCreatorSchema>;
export const popularCreatorListSchema = z.object({ items: z.array(popularCreatorSchema) });
export type PopularCreatorList = z.infer<typeof popularCreatorListSchema>;

// ---- impressions -----------------------------------------------------------------------------

export const recordImpressionsRequestSchema = z.object({
  postIds: z.array(z.uuid()).min(1).max(IMPRESSIONS_BATCH_MAX),
});
export type RecordImpressionsRequest = z.infer<typeof recordImpressionsRequestSchema>;
export const recordImpressionsResponseSchema = z.object({ recorded: z.number().int().min(0) });
export type RecordImpressionsResponse = z.infer<typeof recordImpressionsResponseSchema>;

// ---- tips ------------------------------------------------------------------------------------

export const tipRequestSchema = z.object({
  /** Idempotency key: a retry with the same clientId returns the first tip, never a second one. */
  clientId: z.uuid(),
  amountMinor: amountSchema,
  currency: currencySchema,
  pin: z.string().min(1).max(16),
});
export type TipRequest = z.infer<typeof tipRequestSchema>;

export const tipResponseSchema = z.object({
  mode: walletModeSchema,
  tipId: z.uuid(),
  replayed: z.boolean(),
  amountMinor: z.number().int(),
  currency: currencySchema,
  /** Balance of the sender after the tip. */
  balanceMinor: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type TipResponse = z.infer<typeof tipResponseSchema>;

// ---- boosts ----------------------------------------------------------------------------------

export const boostStatusSchema = z.enum(['active', 'ended', 'cancelled', 'rejected']);
export type BoostStatus = z.infer<typeof boostStatusSchema>;

export const boostPostRequestSchema = z.object({
  clientId: z.uuid(),
  days: z.number().int().min(1).max(BOOST_DAYS_MAX),
  budgetMinor: amountSchema,
  currency: currencySchema,
  pin: z.string().min(1).max(16),
});
export type BoostPostRequest = z.infer<typeof boostPostRequestSchema>;

export const boostSchema = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  status: boostStatusSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  budgetMinor: z.number().int(),
  currency: currencySchema,
  /** Impressions and unique viewers of the post since the boost started (no viewer identity). */
  impressions: z.number().int().min(0),
  uniqueViewers: z.number().int().min(0),
});
export type Boost = z.infer<typeof boostSchema>;

export const boostResponseSchema = z.object({
  mode: walletModeSchema,
  replayed: z.boolean(),
  boost: boostSchema,
  /** Balance of the author after the (fictitious) payment. */
  balanceMinor: z.number().int(),
});
export type BoostResponse = z.infer<typeof boostResponseSchema>;

export const adminBoostSchema = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  userId: z.uuid(),
  status: boostStatusSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  budgetMinor: z.number().int(),
  currency: currencySchema,
});
export type AdminBoost = z.infer<typeof adminBoostSchema>;
export const adminBoostsQuerySchema = pageQuerySchema.extend({ status: boostStatusSchema.optional() });
export type AdminBoostsQuery = z.infer<typeof adminBoostsQuerySchema>;
export const adminBoostListSchema = z.object({ items: z.array(adminBoostSchema), nextCursor: z.string().nullable() });
export type AdminBoostList = z.infer<typeof adminBoostListSchema>;

// ---- creator dashboard -----------------------------------------------------------------------

export const creatorOverviewQuerySchema = z.object({
  days: z.coerce.number().int().refine((v) => v === 7 || v === 30 || v === 90, { message: 'days must be 7, 30 or 90' }).default(7),
});
export type CreatorOverviewQuery = z.infer<typeof creatorOverviewQuerySchema>;

export const creatorDaySchema = z.object({
  /** UTC day, `YYYY-MM-DD`. */
  date: z.string(),
  impressions: z.number().int().min(0),
  uniqueViewers: z.number().int().min(0),
  reactions: z.number().int().min(0),
  comments: z.number().int().min(0),
  newFollowers: z.number().int().min(0),
});
export type CreatorDay = z.infer<typeof creatorDaySchema>;

export const creatorTopPostSchema = z.object({
  postId: z.uuid(),
  excerpt: z.string().nullable(),
  impressions: z.number().int().min(0),
  uniqueViewers: z.number().int().min(0),
  reactions: z.number().int().min(0),
  comments: z.number().int().min(0),
});
export type CreatorTopPost = z.infer<typeof creatorTopPostSchema>;

export const creatorTipTotalSchema = z.object({
  currency: currencySchema,
  totalMinor: z.number().int().min(0),
  count: z.number().int().min(0),
});
export type CreatorTipTotal = z.infer<typeof creatorTipTotalSchema>;

export const creatorOverviewSchema = z.object({
  mode: walletModeSchema,
  days: z.number().int(),
  from: z.string(),
  to: z.string(),
  totals: z.object({
    impressions: z.number().int().min(0),
    /** Sum of the daily unique viewers (a person seen on two days counts twice). */
    uniqueViewers: z.number().int().min(0),
    reactions: z.number().int().min(0),
    comments: z.number().int().min(0),
    bookmarks: z.number().int().min(0),
    newFollowers: z.number().int().min(0),
  }),
  series: z.array(creatorDaySchema),
  topPosts: z.array(creatorTopPostSchema),
  /** Tips received in the window, per currency (fictitious test funds). */
  tipsReceived: z.array(creatorTipTotalSchema),
  boosts: z.array(boostSchema),
});
export type CreatorOverview = z.infer<typeof creatorOverviewSchema>;

// ---- account export --------------------------------------------------------------------------

export const exportedCreatorSchema = z.object({
  boosts: z.array(
    z.object({
      id: z.uuid(),
      postId: z.uuid(),
      status: boostStatusSchema,
      budgetMinor: z.number().int(),
      currency: currencySchema,
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
    }),
  ),
  tips: z.array(
    z.object({
      transferId: z.uuid(),
      direction: z.enum(['sent', 'received']),
      postId: z.uuid().nullable(),
      amountMinor: z.number().int(),
      currency: currencySchema,
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type ExportedCreator = z.infer<typeof exportedCreatorSchema>;
