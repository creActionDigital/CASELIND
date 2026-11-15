import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * Personal health (lot 18a, CDC §12). Highly sensitive: explicit consent, encrypted at rest, private to the user.
 * CASELIND gives no medical advice and does not replace a professional: the clients show that limit.
 */
export const HEALTH_CONSENT_VERSION = '1';

export const healthConsentSchema = z.object({ granted: z.boolean(), version: z.string().nullable(), grantedAt: z.string().nullable() });
export type HealthConsent = z.infer<typeof healthConsentSchema>;
/** The user must state the version they read; an outdated version is refused. */
export const grantHealthConsentRequestSchema = z.object({ version: z.string().trim().min(1).max(20) });
export type GrantHealthConsentRequest = z.infer<typeof grantHealthConsentRequestSchema>;

export const healthEntryKindSchema = z.enum(['allergy', 'condition', 'medication', 'vaccination', 'measurement', 'symptom', 'note']);
export type HealthEntryKind = z.infer<typeof healthEntryKindSchema>;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const entryFields = {
  kind: healthEntryKindSchema,
  recordedOn: date,
  title: z.string().trim().min(1).max(120),
  details: z.string().trim().max(2000),
  /** Only for a symptom: 1 (mild) to 5 (severe). */
  severity: z.number().int().min(1).max(5).nullable(),
};
export const createHealthEntryRequestSchema = z
  .object({ ...entryFields, details: entryFields.details.default(''), severity: entryFields.severity.default(null) })
  .refine((v) => v.severity === null || v.kind === 'symptom', { path: ['severity'], message: 'severity only applies to a symptom' });
export type CreateHealthEntryRequest = z.infer<typeof createHealthEntryRequestSchema>;
/** The kind cannot change. */
export const updateHealthEntryRequestSchema = z.object(entryFields).omit({ kind: true }).partial();
export type UpdateHealthEntryRequest = z.infer<typeof updateHealthEntryRequestSchema>;

export const healthEntryListQuerySchema = pageQuerySchema.extend({ kind: healthEntryKindSchema.optional() });
export type HealthEntryListQuery = z.infer<typeof healthEntryListQuerySchema>;

export const healthEntrySchema = z.object({
  id: z.uuid(),
  kind: healthEntryKindSchema,
  recordedOn: z.string(),
  title: z.string(),
  details: z.string(),
  severity: z.number().int().nullable(),
  createdAt: z.string(),
});
export type HealthEntry = z.infer<typeof healthEntrySchema>;
export const healthEntryListSchema = z.object({ items: z.array(healthEntrySchema), nextCursor: z.string().nullable() });
export type HealthEntryList = z.infer<typeof healthEntryListSchema>;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
export const createReminderRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    dose: z.string().trim().max(120).default(''),
    times: z
      .array(timeOfDay)
      .min(1)
      .max(6)
      .transform((t) => [...new Set(t)].sort()),
    /** Minutes east of UTC of the user's clock, e.g. 120 for Goma (UTC+2). */
    utcOffsetMinutes: z.number().int().min(-840).max(840),
    startsOn: date,
    endsOn: date.nullable().default(null),
  })
  .refine((v) => v.endsOn === null || v.endsOn >= v.startsOn, { path: ['endsOn'], message: 'endsOn must not be before startsOn' });
export type CreateReminderRequest = z.infer<typeof createReminderRequestSchema>;
export const updateReminderRequestSchema = z.object({ active: z.boolean() });
export type UpdateReminderRequest = z.infer<typeof updateReminderRequestSchema>;

export const reminderSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  dose: z.string(),
  times: z.array(z.string()),
  utcOffsetMinutes: z.number().int(),
  startsOn: z.string(),
  endsOn: z.string().nullable(),
  active: z.boolean(),
});
export type Reminder = z.infer<typeof reminderSchema>;
export const reminderListSchema = z.object({ items: z.array(reminderSchema) });
export type ReminderList = z.infer<typeof reminderListSchema>;

export const doseSchema = z.object({ id: z.uuid(), reminderId: z.uuid(), title: z.string(), dose: z.string(), dueAt: z.string(), status: z.enum(['pending', 'taken', 'skipped']) });
export type Dose = z.infer<typeof doseSchema>;
export const doseListSchema = z.object({ items: z.array(doseSchema) });
export type DoseList = z.infer<typeof doseListSchema>;

/** Everything the user stored, decrypted, for the personal data export. */
export const exportedHealthSchema = z.object({
  consent: healthConsentSchema,
  entries: z.array(z.object({ kind: healthEntryKindSchema, recordedOn: z.string(), title: z.string(), details: z.string(), severity: z.number().int().nullable() })),
  reminders: z.array(z.object({ title: z.string(), dose: z.string(), times: z.array(z.string()), startsOn: z.string(), endsOn: z.string().nullable(), active: z.boolean() })),
});
export type ExportedHealth = z.infer<typeof exportedHealthSchema>;
