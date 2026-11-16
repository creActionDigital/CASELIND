import { z } from 'zod';

/**
 * Schools (lot 17b, CDC §13): classes, enrolment, timetable and class announcements of an organisation of kind "school".
 * Pupils may be minors; the school decides who is enrolled and is responsible for parental consent. Nothing is public.
 */
export const schoolRoleSchema = z.enum(['student', 'parent', 'teacher']);
export type SchoolRole = z.infer<typeof schoolRoleSchema>;

export const createClassRequestSchema = z.object({ name: z.string().trim().min(1).max(80), yearLabel: z.string().trim().max(20).default('') });
export type CreateClassRequest = z.infer<typeof createClassRequestSchema>;
export const schoolClassSchema = z.object({ id: z.uuid(), name: z.string(), yearLabel: z.string(), memberCount: z.number().int() });
export type SchoolClass = z.infer<typeof schoolClassSchema>;
export const schoolClassListSchema = z.object({ items: z.array(schoolClassSchema) });
export type SchoolClassList = z.infer<typeof schoolClassListSchema>;

export const enrollRequestSchema = z.object({ handle: z.string().trim().min(1).max(40), role: schoolRoleSchema });
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;
export const classMemberSchema = z.object({ handle: z.string(), displayName: z.string(), role: schoolRoleSchema });
export type ClassMember = z.infer<typeof classMemberSchema>;
export const classMemberListSchema = z.object({ items: z.array(classMemberSchema) });
export type ClassMemberList = z.infer<typeof classMemberListSchema>;

const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'HH:MM');
export const createLessonRequestSchema = z
  .object({ weekday: z.number().int().min(1).max(7), startsAt: hhmm, endsAt: hhmm, subject: z.string().trim().min(1).max(80), room: z.string().trim().max(40).default('') })
  .refine((l) => l.endsAt > l.startsAt, { path: ['endsAt'], message: 'endsAt must be after startsAt' });
export type CreateLessonRequest = z.infer<typeof createLessonRequestSchema>;
export const schoolLessonSchema = z.object({ id: z.uuid(), weekday: z.number().int(), startsAt: z.string(), endsAt: z.string(), subject: z.string(), room: z.string() });
export type SchoolLesson = z.infer<typeof schoolLessonSchema>;

export const createAnnouncementRequestSchema = z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(2000) });
export type CreateAnnouncementRequest = z.infer<typeof createAnnouncementRequestSchema>;
export const announcementSchema = z.object({ id: z.uuid(), title: z.string(), body: z.string(), createdAt: z.string() });
export type Announcement = z.infer<typeof announcementSchema>;

/** What an enrolled person sees of one of their classes. */
export const myClassSchema = z.object({ id: z.uuid(), name: z.string(), yearLabel: z.string(), schoolName: z.string(), role: schoolRoleSchema });
export type MyClass = z.infer<typeof myClassSchema>;
export const myClassListSchema = z.object({ items: z.array(myClassSchema) });
export type MyClassList = z.infer<typeof myClassListSchema>;
export const myClassDetailSchema = z.object({ class: myClassSchema, lessons: z.array(schoolLessonSchema), announcements: z.array(announcementSchema) });
export type MyClassDetail = z.infer<typeof myClassDetailSchema>;
