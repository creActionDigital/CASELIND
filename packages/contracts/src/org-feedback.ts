import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** Avis d'organisation et questions des visiteurs (CDC §5). Distincts des avis produits de orders.ts. */
export const STORE_REVIEW_BODY_MAX = 500;
export const STORE_REVIEW_REPLY_MAX = 500;
export const ORG_QUESTION_MAX = 300;
export const ORG_ANSWER_MAX = 1000;
/** Questions qu'un compte peut poser par 24 h glissantes. */
export const ORG_QUESTIONS_PER_DAY = 5;

/* ------------------------------------------------------------------ avis */

export const storeReviewSchema = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  body: z.string().nullable(),
  author: z.object({ userId: z.uuid(), handle: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }),
  reply: z.object({ body: z.string(), repliedAt: z.iso.datetime() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoreReview = z.infer<typeof storeReviewSchema>;

export const storeReviewListQuerySchema = pageQuerySchema.extend({
  /** Vue vendeur : `unanswered` = sans reponse de l'organisation. */
  status: z.enum(['all', 'unanswered']).default('all'),
});
export type StoreReviewListQuery = z.infer<typeof storeReviewListQuerySchema>;

export const storeReviewListSchema = z.object({ items: z.array(storeReviewSchema), nextCursor: z.string().nullable() });
export type StoreReviewList = z.infer<typeof storeReviewListSchema>;

/** PUT /me/org-reviews/:orgId : cree ou remplace l'avis du compte. */
export const saveStoreReviewRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  /** Absent ou null : note seule. */
  body: z.string().trim().min(1).max(STORE_REVIEW_BODY_MAX).nullable().optional(),
});
export type SaveStoreReviewRequest = z.infer<typeof saveStoreReviewRequestSchema>;

/** GET /me/org-reviews/:orgId : le compte peut-il noter cette organisation, et son avis actuel. */
export const myStoreReviewSchema = z.object({ canReview: z.boolean(), review: storeReviewSchema.nullable(), hidden: z.boolean() });
export type MyStoreReview = z.infer<typeof myStoreReviewSchema>;

export const storeReviewReplyRequestSchema = z.object({ body: z.string().trim().min(1).max(STORE_REVIEW_REPLY_MAX) });
export type StoreReviewReplyRequest = z.infer<typeof storeReviewReplyRequestSchema>;

/** Note moyenne (arrondie a 0,01) et nombre d'avis visibles d'une organisation. */
export const orgRatingSchema = z.object({ average: z.number(), count: z.number().int() });
export type OrgRating = z.infer<typeof orgRatingSchema>;

/* ------------------------------------------------------------------ questions */

export const askOrgQuestionRequestSchema = z.object({
  orgId: z.uuid(),
  question: z.string().trim().min(1).max(ORG_QUESTION_MAX),
});
export type AskOrgQuestionRequest = z.infer<typeof askOrgQuestionRequestSchema>;

export const answerOrgQuestionRequestSchema = z.object({ answer: z.string().trim().min(1).max(ORG_ANSWER_MAX) });
export type AnswerOrgQuestionRequest = z.infer<typeof answerOrgQuestionRequestSchema>;

/** Question repondue, telle que la voit le public : sans l'identite de l'auteur. */
export const publicOrgQuestionSchema = z.object({
  id: z.uuid(),
  question: z.string(),
  answer: z.string(),
  answeredAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type PublicOrgQuestion = z.infer<typeof publicOrgQuestionSchema>;
export const publicOrgQuestionListSchema = z.object({ items: z.array(publicOrgQuestionSchema), nextCursor: z.string().nullable() });
export type PublicOrgQuestionList = z.infer<typeof publicOrgQuestionListSchema>;

export const orgQuestionStatusSchema = z.enum(['pending', 'answered', 'all']);
export const orgQuestionListQuerySchema = pageQuerySchema.extend({ status: orgQuestionStatusSchema.default('pending') });
export type OrgQuestionListQuery = z.infer<typeof orgQuestionListQuerySchema>;

/** Vue vendeur : toutes les questions (masquees par la moderation exclues), avec l'auteur. */
export const orgQuestionSchema = z.object({
  id: z.uuid(),
  question: z.string(),
  answer: z.string().nullable(),
  answeredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  asker: z.object({ userId: z.uuid(), handle: z.string(), displayName: z.string() }),
});
export type OrgQuestion = z.infer<typeof orgQuestionSchema>;
export const orgQuestionListSchema = z.object({ items: z.array(orgQuestionSchema), nextCursor: z.string().nullable() });
export type OrgQuestionList = z.infer<typeof orgQuestionListSchema>;

/** Vue de l'auteur (GET /me/org-questions) : ses questions, en attente ou repondues. */
export const myOrgQuestionSchema = z.object({
  id: z.uuid(),
  org: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
  question: z.string(),
  answer: z.string().nullable(),
  answeredAt: z.iso.datetime().nullable(),
  /** Masquee par la moderation : l'auteur le voit, le public non. */
  hidden: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type MyOrgQuestion = z.infer<typeof myOrgQuestionSchema>;
export const myOrgQuestionListSchema = z.object({ items: z.array(myOrgQuestionSchema), nextCursor: z.string().nullable() });
export type MyOrgQuestionList = z.infer<typeof myOrgQuestionListSchema>;

/* ------------------------------------------------------------------ export de compte */

export const exportedOrgFeedbackSchema = z.object({
  reviews: z.array(z.object({ id: z.uuid(), orgName: z.string(), rating: z.number().int(), body: z.string().nullable(), reply: z.string().nullable(), createdAt: z.string() })),
  questions: z.array(z.object({ id: z.uuid(), orgName: z.string(), question: z.string(), answer: z.string().nullable(), createdAt: z.string() })),
});
export type ExportedOrgFeedback = z.infer<typeof exportedOrgFeedbackSchema>;
