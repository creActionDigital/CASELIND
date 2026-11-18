import { z } from 'zod';
import { myClassDetailSchema } from './school.js';

/**
 * Optional parent-pupil link (lot 17b). The school's staff links an ENROLLED pupil to a parent by the parent's handle; the parent accepts
 * or declines. An active link lets the parent read the pupil's classes, timetable, announcements and fee status (paid or not).
 * The school stays answerable for minors and parental consent: no parent account is ever required.
 */
export const guardianStatusSchema = z.enum(['pending', 'active']);
export type GuardianStatus = z.infer<typeof guardianStatusSchema>;

export const createGuardianRequestSchema = z.object({
  studentHandle: z.string().trim().min(1).max(40),
  guardianHandle: z.string().trim().min(1).max(40),
  relation: z.string().trim().max(40).default(''),
});
export type CreateGuardianRequest = z.infer<typeof createGuardianRequestSchema>;

/** Staff view of one link. */
export const schoolGuardianSchema = z.object({
  id: z.uuid(),
  studentHandle: z.string(),
  studentDisplayName: z.string(),
  guardianHandle: z.string(),
  guardianDisplayName: z.string(),
  relation: z.string(),
  status: guardianStatusSchema,
  createdAt: z.string(),
});
export type SchoolGuardian = z.infer<typeof schoolGuardianSchema>;
export const schoolGuardianListSchema = z.object({ items: z.array(schoolGuardianSchema) });
export type SchoolGuardianList = z.infer<typeof schoolGuardianListSchema>;

/** The parent's own links and invitations. */
export const myGuardianshipSchema = z.object({
  id: z.uuid(),
  schoolName: z.string(),
  studentDisplayName: z.string(),
  relation: z.string(),
  status: guardianStatusSchema,
});
export type MyGuardianship = z.infer<typeof myGuardianshipSchema>;
export const myGuardianshipListSchema = z.object({ items: z.array(myGuardianshipSchema) });
export type MyGuardianshipList = z.infer<typeof myGuardianshipListSchema>;

/** A child the caller follows through an ACTIVE link. */
export const myChildSchema = z.object({
  /** The link: the parent can end it through the decline route. */
  id: z.uuid(),
  studentId: z.uuid(),
  displayName: z.string(),
  schoolName: z.string(),
  relation: z.string(),
});
export type MyChild = z.infer<typeof myChildSchema>;
export const myChildListSchema = z.object({ items: z.array(myChildSchema) });
export type MyChildList = z.infer<typeof myChildListSchema>;

/** Fee status of a child: whether it is paid, never another pupil's status. */
export const childFeeSchema = z.object({
  id: z.uuid(),
  className: z.string(),
  schoolName: z.string(),
  title: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  dueOn: z.string().nullable(),
  paid: z.boolean(),
});
export type ChildFee = z.infer<typeof childFeeSchema>;
export const childFeeListSchema = z.object({ items: z.array(childFeeSchema) });
export type ChildFeeList = z.infer<typeof childFeeListSchema>;

/** Classes of a child with timetable and latest announcements (same shape as the pupil's own view). */
export const childClassListSchema = z.object({ items: z.array(myClassDetailSchema) });
export type ChildClassList = z.infer<typeof childClassListSchema>;

/** Account export: the links where the user is the parent or the pupil (ids and relation only). */
export const exportedGuardianSchema = z.object({ id: z.uuid(), role: z.enum(['guardian', 'student']), otherUserId: z.uuid(), relation: z.string(), status: guardianStatusSchema });
export type ExportedGuardian = z.infer<typeof exportedGuardianSchema>;
export const exportedSchoolFeeSchema = z.object({ title: z.string(), dueOn: z.string().nullable(), paid: z.boolean() });
export type ExportedSchoolFee = z.infer<typeof exportedSchoolFeeSchema>;
