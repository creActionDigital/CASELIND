import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * Freelance (lot 16b, CDC §14): missions, proposals, contracts with milestones, reviews, disputes.
 * No payment is processed by CASELIND yet: a contract says `paymentMode: 'external'` (escrow comes with real payments).
 */
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const minor = z.number().int().positive().max(1_000_000_000_000);

/** Fixed list of mission categories (stable slug ids; labels live in the apps). */
export const missionCategories = ['design', 'developpement', 'redaction', 'traduction', 'marketing', 'comptabilite', 'formation', 'autre'] as const;
export const missionCategorySchema = z.enum(missionCategories);
export type MissionCategory = z.infer<typeof missionCategorySchema>;

const missionFields = {
  category: missionCategorySchema,
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4000),
  budgetMinor: minor,
  currency: currencySchema,
  /** YYYY-MM-DD. */
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
};
export const createMissionRequestSchema = z.object({
  ...missionFields,
  description: missionFields.description.default(''),
  category: missionCategorySchema.default('autre'),
  deadline: missionFields.deadline.default(null),
});
export type CreateMissionRequest = z.infer<typeof createMissionRequestSchema>;

/** Edit while the mission is open. */
export const updateMissionRequestSchema = z.object(missionFields).omit({ currency: true }).partial();
export type UpdateMissionRequest = z.infer<typeof updateMissionRequestSchema>;

export const missionListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  currency: currencySchema.optional(),
  category: missionCategorySchema.optional(),
  minBudgetMinor: z.coerce.number().int().min(0).optional(),
  maxBudgetMinor: z.coerce.number().int().min(0).optional(),
});
export type MissionListQuery = z.infer<typeof missionListQuerySchema>;

export const missionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  budgetMinor: z.number().int(),
  currency: z.string(),
  category: missionCategorySchema,
  deadline: z.string().nullable(),
  status: z.enum(['open', 'awarded', 'closed']),
  client: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  mine: z.boolean(),
  proposalCount: z.number().int().nullable(),
  /** The caller's own proposal on this mission, if any. */
  myProposalId: z.uuid().nullable(),
  contractId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type Mission = z.infer<typeof missionSchema>;
export const missionListSchema = z.object({ items: z.array(missionSchema), nextCursor: z.string().nullable() });
export type MissionList = z.infer<typeof missionListSchema>;

export const createProposalRequestSchema = z.object({
  amountMinor: minor,
  deliveryDays: z.number().int().min(1).max(365),
  message: z.string().trim().max(2000).default(''),
});
export type CreateProposalRequest = z.infer<typeof createProposalRequestSchema>;

export const proposalSchema = z.object({
  id: z.uuid(),
  missionId: z.uuid(),
  missionTitle: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  deliveryDays: z.number().int(),
  message: z.string(),
  status: z.enum(['proposed', 'accepted', 'rejected', 'withdrawn']),
  freelancer: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof proposalSchema>;
export const proposalListSchema = z.object({ items: z.array(proposalSchema), nextCursor: z.string().nullable() });
export type ProposalList = z.infer<typeof proposalListSchema>;

/** Accepting a proposal opens the contract. Milestones must add up to the proposed amount; none given = one milestone for everything. */
export const acceptProposalRequestSchema = z.object({
  milestones: z.array(z.object({ title: z.string().trim().min(1).max(120), amountMinor: minor })).min(1).max(10).optional(),
});
export type AcceptProposalRequest = z.infer<typeof acceptProposalRequestSchema>;

export const milestoneSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  title: z.string(),
  amountMinor: z.number().int(),
  status: z.enum(['pending', 'delivered', 'revision', 'approved']),
  note: z.string(),
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const contractSchema = z.object({
  id: z.uuid(),
  missionId: z.uuid(),
  missionTitle: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  /** Always 'external' for now: CASELIND does not move the money. */
  paymentMode: z.literal('external'),
  status: z.enum(['active', 'completed', 'cancelled', 'disputed']),
  client: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  freelancer: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  role: z.enum(['client', 'freelancer']),
  milestones: z.array(milestoneSchema),
  /** Ratings left by each side (null until given). */
  myReview: z.object({ rating: z.number().int(), body: z.string() }).nullable(),
  theirReview: z.object({ rating: z.number().int(), body: z.string() }).nullable(),
  dispute: z.object({ id: z.uuid(), status: z.enum(['open', 'resolved']), reason: z.string(), outcome: z.enum(['resume', 'cancel']).nullable(), resolution: z.string() }).nullable(),
  createdAt: z.string(),
});
export type Contract = z.infer<typeof contractSchema>;
export const contractListSchema = z.object({ items: z.array(contractSchema), nextCursor: z.string().nullable() });
export type ContractList = z.infer<typeof contractListSchema>;

export const deliverMilestoneRequestSchema = z.object({ note: z.string().trim().max(2000).default('') });
export type DeliverMilestoneRequest = z.infer<typeof deliverMilestoneRequestSchema>;
export const reviseMilestoneRequestSchema = z.object({ note: z.string().trim().min(3).max(2000) });
export type ReviseMilestoneRequest = z.infer<typeof reviseMilestoneRequestSchema>;

export const reviewContractRequestSchema = z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(1000).default('') });
export type ReviewContractRequest = z.infer<typeof reviewContractRequestSchema>;

export const openDisputeRequestSchema = z.object({ reason: z.string().trim().min(5).max(2000) });
export type OpenDisputeRequest = z.infer<typeof openDisputeRequestSchema>;

/** Platform admin: `resume` puts the contract back to active, `cancel` cancels it. No money moves (payments are external). */
export const resolveDisputeRequestSchema = z.object({ outcome: z.enum(['resume', 'cancel']), resolution: z.string().trim().min(3).max(2000) });
export type ResolveDisputeRequest = z.infer<typeof resolveDisputeRequestSchema>;

export const adminDisputeSchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  missionTitle: z.string(),
  openedBy: z.object({ id: z.uuid(), handle: z.string() }),
  reason: z.string(),
  status: z.enum(['open', 'resolved']),
  outcome: z.enum(['resume', 'cancel']).nullable(),
  resolution: z.string(),
  createdAt: z.string(),
});
export type AdminDispute = z.infer<typeof adminDisputeSchema>;
export const adminDisputeListSchema = z.object({ items: z.array(adminDisputeSchema), nextCursor: z.string().nullable() });
export type AdminDisputeList = z.infer<typeof adminDisputeListSchema>;
export const adminDisputesQuerySchema = pageQuerySchema.extend({ status: z.enum(['open', 'resolved']).optional() });
export type AdminDisputesQuery = z.infer<typeof adminDisputesQuerySchema>;

/** Public freelancer profile (lot 16e): opt-in, no contact data. Skills are lowercase words (at most 15). */
const profileFields = {
  title: z.string().trim().min(3).max(120),
  skills: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(15),
  categories: z.array(missionCategorySchema).max(5),
  /** Indicative rate in minor units; rateMinor and rateCurrency go together. */
  rateMinor: minor.nullable(),
  rateCurrency: z.enum(['USD', 'CDF']).nullable(),
  bio: z.string().trim().max(1000),
};
export const saveFreelanceProfileRequestSchema = z
  .object({ enabled: z.boolean(), ...profileFields, categories: profileFields.categories.default([]), rateMinor: minor.nullable().default(null), rateCurrency: profileFields.rateCurrency.default(null), bio: profileFields.bio.default('') })
  .refine((v) => (v.rateMinor === null) === (v.rateCurrency === null), { message: 'rateMinor and rateCurrency go together', path: ['rateMinor'] });
export type SaveFreelanceProfileRequest = z.infer<typeof saveFreelanceProfileRequestSchema>;
/** `updatedAt` is null while nothing was ever saved (the blank profile is returned, disabled). */
export const myFreelanceProfileSchema = z.object({
  enabled: z.boolean(),
  title: z.string(),
  skills: z.array(z.string()),
  categories: z.array(missionCategorySchema),
  rateMinor: z.number().int().nullable(),
  rateCurrency: z.enum(['USD', 'CDF']).nullable(),
  bio: z.string(),
  updatedAt: z.string().nullable(),
});
export type MyFreelanceProfile = z.infer<typeof myFreelanceProfileSchema>;
export const freelancerSchema = z.object({
  user: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  ...profileFields,
});
export type Freelancer = z.infer<typeof freelancerSchema>;
export const freelancerListSchema = z.object({ items: z.array(freelancerSchema), nextCursor: z.string().nullable() });
export type FreelancerList = z.infer<typeof freelancerListSchema>;
export const freelancerListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  skill: z.string().trim().toLowerCase().max(30).optional(),
  category: missionCategorySchema.optional(),
});
export type FreelancerListQuery = z.infer<typeof freelancerListQuerySchema>;
