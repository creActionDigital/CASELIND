import { z } from 'zod';
import { healthEntryKindSchema } from './health.js';
import { pageQuerySchema } from './pagination.js';

/**
 * Health professionals, appointments, record sharing and e-prescriptions (lot 18b, CDC §12).
 * Behind the regulated `health` flag; teleconsultation and prescriptions each have their own regulated flag.
 * A professional is only listed once an administrator verified the licence.
 */
export const professionalKindSchema = z.enum(['doctor', 'dentist', 'laboratory', 'pharmacist', 'nurse', 'psychologist', 'other']);
export type ProfessionalKind = z.infer<typeof professionalKindSchema>;

export const applyProfessionalRequestSchema = z.object({
  kind: professionalKindSchema,
  specialty: z.string().trim().max(80).default(''),
  licenseNumber: z.string().trim().min(3).max(60),
  city: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(1000).default(''),
});
export type ApplyProfessionalRequest = z.infer<typeof applyProfessionalRequestSchema>;

export const professionalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'suspended']);

/** What the public directory shows: never the licence number. */
export const professionalSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  handle: z.string(),
  kind: professionalKindSchema,
  specialty: z.string(),
  city: z.string(),
  bio: z.string(),
});
export type Professional = z.infer<typeof professionalSchema>;
export const professionalListSchema = z.object({ items: z.array(professionalSchema), nextCursor: z.string().nullable() });
export type ProfessionalList = z.infer<typeof professionalListSchema>;
export const professionalListQuerySchema = pageQuerySchema.extend({
  kind: professionalKindSchema.optional(),
  city: z.string().trim().max(80).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ProfessionalListQuery = z.infer<typeof professionalListQuerySchema>;

/** The professional's own application with its verification status. */
export const myProfessionalSchema = z.object({
  profile: z
    .object({
      kind: professionalKindSchema,
      specialty: z.string(),
      licenseNumber: z.string(),
      city: z.string(),
      bio: z.string(),
      status: professionalStatusSchema,
      reviewNote: z.string(),
    })
    .nullable(),
});
export type MyProfessional = z.infer<typeof myProfessionalSchema>;

export const adminProfessionalSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  handle: z.string(),
  kind: professionalKindSchema,
  specialty: z.string(),
  licenseNumber: z.string(),
  city: z.string(),
  status: professionalStatusSchema,
  reviewNote: z.string(),
  createdAt: z.string(),
});
export type AdminProfessional = z.infer<typeof adminProfessionalSchema>;
export const adminProfessionalListSchema = z.object({ items: z.array(adminProfessionalSchema), nextCursor: z.string().nullable() });
export type AdminProfessionalList = z.infer<typeof adminProfessionalListSchema>;
export const adminProfessionalsQuerySchema = pageQuerySchema.extend({ status: professionalStatusSchema.optional() });
export type AdminProfessionalsQuery = z.infer<typeof adminProfessionalsQuerySchema>;
export const reviewProfessionalRequestSchema = z.object({ decision: z.enum(['approve', 'reject', 'suspend']), note: z.string().trim().max(1000).default('') });
export type ReviewProfessionalRequest = z.infer<typeof reviewProfessionalRequestSchema>;

export const appointmentModeSchema = z.enum(['in_person', 'teleconsultation']);
export const createAppointmentRequestSchema = z.object({
  professionalId: z.uuid(),
  /** Must be in the future. */
  startsAt: z.string().datetime(),
  mode: appointmentModeSchema.default('in_person'),
  reason: z.string().trim().max(1000).default(''),
});
export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;

export const appointmentSchema = z.object({
  id: z.uuid(),
  startsAt: z.string(),
  mode: appointmentModeSchema,
  status: z.enum(['requested', 'confirmed', 'declined', 'cancelled', 'completed']),
  role: z.enum(['patient', 'professional']),
  /** The other party. */
  other: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  /** The reason the patient wrote; visible to both sides of this appointment. */
  reason: z.string(),
  hasPrescription: z.boolean(),
});
export type Appointment = z.infer<typeof appointmentSchema>;
export const appointmentListSchema = z.object({ items: z.array(appointmentSchema), nextCursor: z.string().nullable() });
export type AppointmentList = z.infer<typeof appointmentListSchema>;

export const createShareRequestSchema = z.object({
  professionalId: z.uuid(),
  kinds: z.array(healthEntryKindSchema).min(1).max(7).transform((k) => [...new Set(k)]),
  /** 1 to 30 days; default 7. */
  days: z.number().int().min(1).max(30).default(7),
});
export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;
export const shareSchema = z.object({
  id: z.uuid(),
  professional: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  kinds: z.array(healthEntryKindSchema),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  active: z.boolean(),
});
export type Share = z.infer<typeof shareSchema>;
export const shareListSchema = z.object({ items: z.array(shareSchema) });
export type ShareList = z.infer<typeof shareListSchema>;

export const accessLogSchema = z.object({
  items: z.array(z.object({ at: z.string(), accessor: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }), entriesCount: z.number().int() })),
});
export type AccessLog = z.infer<typeof accessLogSchema>;

/** A patient's shared record as a professional reads it. Every call is logged for the patient. */
export const sharedRecordSchema = z.object({
  patient: z.object({ id: z.uuid(), displayName: z.string() }),
  expiresAt: z.string(),
  entries: z.array(z.object({ kind: healthEntryKindSchema, recordedOn: z.string(), title: z.string(), details: z.string(), severity: z.number().int().nullable() })),
});
export type SharedRecord = z.infer<typeof sharedRecordSchema>;
/** The patients who currently share something with the caller. */
export const sharedPatientsSchema = z.object({
  items: z.array(z.object({ shareId: z.uuid(), patient: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }), kinds: z.array(healthEntryKindSchema), expiresAt: z.string() })),
});
export type SharedPatients = z.infer<typeof sharedPatientsSchema>;

export const prescriptionItemSchema = z.object({ name: z.string().trim().min(1).max(120), dose: z.string().trim().max(120).default(''), instructions: z.string().trim().max(500).default('') });
/** Issued by the professional of a completed appointment. Needs the regulated `health.prescriptions` flag. */
export const createPrescriptionRequestSchema = z.object({
  items: z.array(prescriptionItemSchema).min(1).max(20),
  /** YYYY-MM-DD, at most 12 months ahead. */
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreatePrescriptionRequest = z.infer<typeof createPrescriptionRequestSchema>;
export const prescriptionSchema = z.object({
  id: z.uuid(),
  appointmentId: z.uuid(),
  code: z.string(),
  validUntil: z.string(),
  items: z.array(z.object({ name: z.string(), dose: z.string(), instructions: z.string() })),
  professional: z.object({ id: z.uuid(), displayName: z.string() }),
  createdAt: z.string(),
});
export type Prescription = z.infer<typeof prescriptionSchema>;
export const prescriptionListSchema = z.object({ items: z.array(prescriptionSchema) });
export type PrescriptionList = z.infer<typeof prescriptionListSchema>;
