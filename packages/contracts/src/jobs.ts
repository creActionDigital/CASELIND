import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** Jobs (lot 16a, CDC §14): offers by organisations, a personal CV, applications. No candidate search, no video interview yet. */
export const contractTypeSchema = z.enum(['full_time', 'part_time', 'contract', 'internship', 'temporary']);
export type ContractType = z.infer<typeof contractTypeSchema>;

export const applicationStatusSchema = z.enum(['submitted', 'viewed', 'shortlisted', 'interview', 'offered', 'hired', 'rejected', 'withdrawn']);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const minor = z.number().int().min(0).max(1_000_000_000_000);

const jobFields = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4000),
  city: z.string().trim().min(2).max(80),
  contractType: contractTypeSchema,
  salaryMinMinor: minor.nullable(),
  salaryMaxMinor: minor.nullable(),
  currency: currencySchema.nullable(),
};

type SalaryShape = { salaryMinMinor?: number | null; salaryMaxMinor?: number | null; currency?: string | null };
const refineSalary = <T extends z.ZodType<SalaryShape>>(s: T) =>
  s
    .refine(
      (v) => {
        const any = v.salaryMinMinor != null || v.salaryMaxMinor != null;
        return any === (v.currency != null);
      },
      { path: ['currency'], message: 'a salary needs a currency, and a currency needs a salary' },
    )
    .refine((v) => v.salaryMinMinor == null || v.salaryMaxMinor == null || v.salaryMinMinor <= v.salaryMaxMinor, {
      path: ['salaryMaxMinor'],
      message: 'salaryMaxMinor must be at least salaryMinMinor',
    });

export const createJobRequestSchema = refineSalary(
  z.object({
    ...jobFields,
    description: jobFields.description.default(''),
    salaryMinMinor: jobFields.salaryMinMinor.default(null),
    salaryMaxMinor: jobFields.salaryMaxMinor.default(null),
    currency: jobFields.currency.default(null),
  }),
);
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const updateJobRequestSchema = refineSalary(z.object(jobFields).partial());
export type UpdateJobRequest = z.infer<typeof updateJobRequestSchema>;

export const jobListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(80).optional(),
  contractType: contractTypeSchema.optional(),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

export const jobSchema = z.object({
  id: z.uuid(),
  org: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), verified: z.boolean() }),
  title: z.string(),
  description: z.string(),
  city: z.string(),
  contractType: contractTypeSchema,
  salary: z.object({ minMinor: z.number().int().nullable(), maxMinor: z.number().int().nullable(), currency: z.string() }).nullable(),
  status: z.enum(['open', 'closed']),
  createdAt: z.string(),
  /** Whether the caller already applied. */
  applied: z.boolean(),
});
export type Job = z.infer<typeof jobSchema>;
export const jobListSchema = z.object({ items: z.array(jobSchema), nextCursor: z.string().nullable() });
export type JobList = z.infer<typeof jobListSchema>;

/** The personal CV. Visible only to the organisations the user applied to, as a snapshot. */
export const jobProfileInputSchema = z.object({
  headline: z.string().trim().min(2).max(120),
  summary: z.string().trim().max(2000).default(''),
  skills: z
    .array(z.string().trim().min(1).max(40))
    .max(15)
    .default([])
    .transform((s) => [...new Set(s)]),
  city: z.string().trim().max(80).default(''),
  experience: z.string().trim().max(4000).default(''),
  education: z.string().trim().max(2000).default(''),
});
export type JobProfileInput = z.infer<typeof jobProfileInputSchema>;
export const jobProfileSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  skills: z.array(z.string()),
  city: z.string(),
  experience: z.string(),
  education: z.string(),
});
export type JobProfile = z.infer<typeof jobProfileSchema>;

export const applyRequestSchema = z.object({ message: z.string().trim().max(2000).default('') });
export type ApplyRequest = z.infer<typeof applyRequestSchema>;

export const applicationSchema = z.object({
  id: z.uuid(),
  status: applicationStatusSchema,
  message: z.string(),
  job: z.object({ id: z.uuid(), title: z.string(), orgName: z.string() }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Application = z.infer<typeof applicationSchema>;
export const applicationListSchema = z.object({ items: z.array(applicationSchema), nextCursor: z.string().nullable() });
export type ApplicationList = z.infer<typeof applicationListSchema>;

/** Recruiter view: the applicant and the CV as it was when they applied. */
export const orgApplicationSchema = applicationSchema.extend({
  applicant: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  cv: jobProfileSchema,
});
export type OrgApplication = z.infer<typeof orgApplicationSchema>;
export const orgApplicationListSchema = z.object({ items: z.array(orgApplicationSchema), nextCursor: z.string().nullable() });
export type OrgApplicationList = z.infer<typeof orgApplicationListSchema>;

export const orgApplicationsQuerySchema = pageQuerySchema.extend({ status: applicationStatusSchema.optional() });
export type OrgApplicationsQuery = z.infer<typeof orgApplicationsQuerySchema>;

/** Statuses a recruiter can set. `submitted` and `withdrawn` are not theirs to set. */
export const setApplicationStatusRequestSchema = z.object({
  status: z.enum(['viewed', 'shortlisted', 'interview', 'offered', 'hired', 'rejected']),
});
export type SetApplicationStatusRequest = z.infer<typeof setApplicationStatusRequestSchema>;

/** Allowed recruiter transitions. Terminal: hired, rejected, withdrawn. */
export const APPLICATION_TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  submitted: ['viewed', 'shortlisted', 'rejected'],
  viewed: ['shortlisted', 'interview', 'rejected'],
  shortlisted: ['interview', 'offered', 'rejected'],
  interview: ['offered', 'rejected'],
  offered: ['hired', 'rejected'],
  hired: [],
  rejected: [],
  withdrawn: [],
};
export const isTerminalApplication = (s: ApplicationStatus): boolean => APPLICATION_TRANSITIONS[s].length === 0;

/** GET /v1/me/job-profile: wrapped so that "no CV yet" is a real JSON body. */
export const myJobProfileSchema = z.object({ profile: jobProfileSchema.nullable() });
export type MyJobProfile = z.infer<typeof myJobProfileSchema>;
