import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * Gestion d'entreprise, seconde partie (CDC §8) : ressources humaines. Miroir de la migration 0084.
 * Registre de salaire = état saisi À LA MAIN (montant brut déclaré) : aucun calcul de paie, de cotisation ni d'impôt.
 */

export const LEAVE_MAX_DAYS = 366;
export const SHIFT_RANGE_MAX_DAYS = 62;
export const HR_EMPLOYEES_MAX = 500;

const MS_DAY = 86_400_000;

/** Date civile AAAA-MM-JJ valide (le 31 février est refusé). */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, 'invalid calendar date');

export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM');

/** Jours calendaires entre deux dates AAAA-MM-JJ, bornes comprises (même jour = 1). */
export function leaveDays(startsOn: string, endsOn: string): number {
  return Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / MS_DAY) + 1;
}

export const employmentTypeSchema = z.enum(['full_time', 'part_time', 'contract', 'intern']);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;
export const leaveKindSchema = z.enum(['annual', 'sick', 'unpaid', 'maternity', 'other']);
export type LeaveKind = z.infer<typeof leaveKindSchema>;
export const leaveStatusSchema = z.enum(['requested', 'approved', 'rejected', 'cancelled']);
export type LeaveStatus = z.infer<typeof leaveStatusSchema>;
export const hrCurrencySchema = z.enum(['USD', 'CDF']);

const optText = (max: number) => z.string().trim().min(1).max(max).nullish();

// ---- fiches employé ---------------------------------------------------------------------

export const saveEmployeeProfileRequestSchema = z
  .object({
    jobTitle: z.string().trim().min(1).max(80),
    department: optText(60),
    employmentType: employmentTypeSchema,
    startedOn: calendarDateSchema,
    endedOn: calendarDateSchema.nullish(),
    managerUserId: z.uuid().nullish(),
    /** Quota annuel de congés (jours) : sert au solde indicatif. */
    annualLeaveDays: z.number().int().min(0).max(365).nullish(),
    /** Note visible de la RH seulement. */
    note: optText(300),
  })
  .refine((b) => !b.endedOn || b.endedOn >= b.startedOn, { path: ['endedOn'], message: 'must not be before startedOn' });
export type SaveEmployeeProfileRequest = z.infer<typeof saveEmployeeProfileRequestSchema>;

export const employeeProfileSchema = z.object({
  jobTitle: z.string(),
  department: z.string().nullable(),
  employmentType: employmentTypeSchema,
  startedOn: z.string(),
  endedOn: z.string().nullable(),
  managerUserId: z.string().nullable(),
  annualLeaveDays: z.number().nullable(),
  /** Toujours null hors RH. */
  note: z.string().nullable(),
});
export type EmployeeProfile = z.infer<typeof employeeProfileSchema>;

export const employeeSchema = z.object({
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  role: z.string(),
  profile: employeeProfileSchema.nullable(),
});
export type Employee = z.infer<typeof employeeSchema>;
export const employeeListSchema = z.object({ items: z.array(employeeSchema) });
export type EmployeeList = z.infer<typeof employeeListSchema>;

/** Solde INDICATIF de l'année civile en cours (jours calendaires) ; aucune règle légale n'est appliquée. */
export const leaveBalanceSchema = z.object({
  year: z.number().int(),
  annualQuotaDays: z.number().nullable(),
  annualUsedDays: z.number(),
  annualPendingDays: z.number(),
  annualRemainingDays: z.number().nullable(),
  usedByKind: z.array(z.object({ kind: leaveKindSchema, days: z.number() })),
});
export type LeaveBalance = z.infer<typeof leaveBalanceSchema>;

export const employeeDetailSchema = employeeSchema.extend({ balance: leaveBalanceSchema });
export type EmployeeDetail = z.infer<typeof employeeDetailSchema>;

// ---- congés -----------------------------------------------------------------------------

export const createLeaveRequestSchema = z
  .object({
    kind: leaveKindSchema,
    startsOn: calendarDateSchema,
    endsOn: calendarDateSchema,
    reason: optText(300),
  })
  .refine((b) => b.endsOn >= b.startsOn, { path: ['endsOn'], message: 'must not be before startsOn' })
  .refine((b) => b.endsOn < b.startsOn || leaveDays(b.startsOn, b.endsOn) <= LEAVE_MAX_DAYS, { path: ['endsOn'], message: 'too long' });
export type CreateLeaveRequest = z.infer<typeof createLeaveRequestSchema>;

export const decideLeaveRequestSchema = z.object({ decision: z.enum(['approve', 'reject']), note: optText(300) });
export type DecideLeaveRequest = z.infer<typeof decideLeaveRequestSchema>;

export const leaveRequestSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  kind: leaveKindSchema,
  startsOn: z.string(),
  endsOn: z.string(),
  /** Calculé par le serveur (jours calendaires, bornes comprises). */
  days: z.number().int(),
  reason: z.string().nullable(),
  status: leaveStatusSchema,
  decidedBy: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
});
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;

export const leaveListQuerySchema = pageQuerySchema.extend({ status: leaveStatusSchema.optional(), userId: z.uuid().optional() });
export type LeaveListQuery = z.infer<typeof leaveListQuerySchema>;
export const leaveListSchema = z.object({ items: z.array(leaveRequestSchema), nextCursor: z.string().nullable() });
export type LeaveList = z.infer<typeof leaveListSchema>;

export const myOrgQuerySchema = z.object({ orgId: z.uuid() });
export type MyOrgQuery = z.infer<typeof myOrgQuerySchema>;
export const myLeavesSchema = z.object({ items: z.array(leaveRequestSchema), balance: leaveBalanceSchema });
export type MyLeaves = z.infer<typeof myLeavesSchema>;

// ---- plannings --------------------------------------------------------------------------

export const createShiftRequestSchema = z
  .object({ userId: z.uuid(), shiftDate: calendarDateSchema, startsAt: timeOfDaySchema, endsAt: timeOfDaySchema, note: optText(100) })
  .refine((b) => b.startsAt < b.endsAt, { path: ['endsAt'], message: 'must be after startsAt (no overnight shift)' });
export type CreateShiftRequest = z.infer<typeof createShiftRequestSchema>;

export const shiftSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  shiftDate: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  note: z.string().nullable(),
});
export type Shift = z.infer<typeof shiftSchema>;

const rangeOk = (b: { from: string; to: string }) => b.to >= b.from && leaveDays(b.from, b.to) <= SHIFT_RANGE_MAX_DAYS;
export const shiftListQuerySchema = z
  .object({ from: calendarDateSchema, to: calendarDateSchema, userId: z.uuid().optional() })
  .refine(rangeOk, { path: ['to'], message: 'range of at most 62 days, from <= to' });
export type ShiftListQuery = z.infer<typeof shiftListQuerySchema>;
export const myShiftListQuerySchema = z
  .object({ orgId: z.uuid(), from: calendarDateSchema, to: calendarDateSchema })
  .refine(rangeOk, { path: ['to'], message: 'range of at most 62 days, from <= to' });
export type MyShiftListQuery = z.infer<typeof myShiftListQuerySchema>;
export const shiftListSchema = z.object({ items: z.array(shiftSchema) });
export type ShiftList = z.infer<typeof shiftListSchema>;

// ---- registre de salaire ----------------------------------------------------------------

export const saveSalaryLineRequestSchema = z.object({
  userId: z.uuid(),
  /** 1er jour du mois concerné. */
  period: calendarDateSchema.refine((s) => s.endsWith('-01'), 'period must be the first day of the month'),
  grossMinor: z.number().int().min(0).max(1_000_000_000_000),
  currency: hrCurrencySchema,
  note: optText(200),
});
export type SaveSalaryLineRequest = z.infer<typeof saveSalaryLineRequestSchema>;

export const salaryLineSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  period: z.string(),
  grossMinor: z.number().int(),
  currency: z.string(),
  note: z.string().nullable(),
  recordedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type SalaryLine = z.infer<typeof salaryLineSchema>;
export const salaryListQuerySchema = z.object({ userId: z.uuid().optional(), year: z.coerce.number().int().min(2000).max(2200).optional() });
export type SalaryListQuery = z.infer<typeof salaryListQuerySchema>;
export const salaryListSchema = z.object({ items: z.array(salaryLineSchema) });
export type SalaryList = z.infer<typeof salaryListSchema>;

// ---- export de compte -------------------------------------------------------------------

export const exportedHrSchema = z.object({
  profiles: z.array(employeeProfileSchema.omit({ note: true }).extend({ orgId: z.uuid() })),
  leaves: z.array(
    z.object({ orgId: z.uuid(), id: z.uuid(), kind: leaveKindSchema, startsOn: z.string(), endsOn: z.string(), days: z.number().int(), reason: z.string().nullable(), status: leaveStatusSchema, createdAt: z.string() }),
  ),
  shifts: z.array(z.object({ orgId: z.uuid(), id: z.uuid(), shiftDate: z.string(), startsAt: z.string(), endsAt: z.string(), note: z.string().nullable() })),
  salary: z.array(z.object({ orgId: z.uuid(), id: z.uuid(), period: z.string(), grossMinor: z.number().int(), currency: z.string(), note: z.string().nullable() })),
});
export type ExportedHr = z.infer<typeof exportedHrSchema>;
