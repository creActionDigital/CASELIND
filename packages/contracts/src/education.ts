import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** Education (lot 17a, CDC §13): courses, lessons, a quiz, progress, verifiable certificates. */
export const courseLevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);
export type CourseLevel = z.infer<typeof courseLevelSchema>;
export const courseLanguageSchema = z.enum(['fr', 'en', 'sw', 'ln']);
export type CourseLanguage = z.infer<typeof courseLanguageSchema>;

const courseFields = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4000),
  level: courseLevelSchema,
  language: courseLanguageSchema,
};
export const createCourseRequestSchema = z.object({ ...courseFields, description: courseFields.description.default('') });
export type CreateCourseRequest = z.infer<typeof createCourseRequestSchema>;
export const updateCourseRequestSchema = z.object(courseFields).partial();
export type UpdateCourseRequest = z.infer<typeof updateCourseRequestSchema>;

export const courseListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  level: courseLevelSchema.optional(),
  language: courseLanguageSchema.optional(),
});
export type CourseListQuery = z.infer<typeof courseListQuerySchema>;

export const lessonInputSchema = z.object({ title: z.string().trim().min(1).max(120), content: z.string().trim().max(8000).default('') });
/** Replaces the whole ordered list of lessons. */
export const setLessonsRequestSchema = z.object({ lessons: z.array(lessonInputSchema).max(50) });
export type SetLessonsRequest = z.infer<typeof setLessonsRequestSchema>;

export const questionInputSchema = z
  .object({
    prompt: z.string().trim().min(1).max(500),
    options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
    correctIndex: z.number().int().min(0),
  })
  .refine((q) => q.correctIndex < q.options.length, { path: ['correctIndex'], message: 'correctIndex must point to one of the options' });
/** Replaces the whole quiz. An empty list removes it. */
export const setQuizRequestSchema = z.object({ passPercent: z.number().int().min(1).max(100).default(70), questions: z.array(questionInputSchema).max(50) });
export type SetQuizRequest = z.infer<typeof setQuizRequestSchema>;

export const courseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  level: courseLevelSchema,
  language: courseLanguageSchema,
  status: z.enum(['draft', 'published']),
  passPercent: z.number().int(),
  author: z.object({ id: z.uuid(), displayName: z.string(), handle: z.string() }),
  mine: z.boolean(),
  lessonCount: z.number().int(),
  questionCount: z.number().int(),
  enrolled: z.boolean(),
  /** Average of the visible reviews (null without any) and their count. */
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
  createdAt: z.string(),
});
export type Course = z.infer<typeof courseSchema>;
export const courseListSchema = z.object({ items: z.array(courseSchema), nextCursor: z.string().nullable() });
export type CourseList = z.infer<typeof courseListSchema>;

/** Lesson text is only given to enrolled learners and to the author; everyone else sees the titles. */
export const lessonSchema = z.object({ id: z.uuid(), position: z.number().int(), title: z.string(), content: z.string().nullable(), done: z.boolean() });
export type Lesson = z.infer<typeof lessonSchema>;

export const courseDetailSchema = courseSchema.extend({
  lessons: z.array(lessonSchema),
  progressPercent: z.number().int().nullable(),
  bestScorePercent: z.number().int().nullable(),
  certificateCode: z.string().nullable(),
});
export type CourseDetail = z.infer<typeof courseDetailSchema>;

/** The quiz as a learner sees it: no answer key. */
export const quizSchema = z.object({
  passPercent: z.number().int(),
  questions: z.array(z.object({ id: z.uuid(), prompt: z.string(), options: z.array(z.string()) })),
});
export type Quiz = z.infer<typeof quizSchema>;

export const quizAttemptRequestSchema = z.object({ answers: z.array(z.number().int().min(0)).max(50) });
export type QuizAttemptRequest = z.infer<typeof quizAttemptRequestSchema>;
export const quizResultSchema = z.object({
  scorePercent: z.number().int(),
  passed: z.boolean(),
  correct: z.number().int(),
  total: z.number().int(),
  certificateCode: z.string().nullable(),
});
export type QuizResult = z.infer<typeof quizResultSchema>;

export const enrollmentSchema = z.object({
  courseId: z.uuid(),
  title: z.string(),
  author: z.string(),
  progressPercent: z.number().int(),
  completed: z.boolean(),
  certificateCode: z.string().nullable(),
  enrolledAt: z.string(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;
export const enrollmentListSchema = z.object({ items: z.array(enrollmentSchema), nextCursor: z.string().nullable() });
export type EnrollmentList = z.infer<typeof enrollmentListSchema>;

export const certificateSchema = z.object({ code: z.string(), courseId: z.uuid(), courseTitle: z.string(), holderName: z.string(), issuedAt: z.string() });
export type Certificate = z.infer<typeof certificateSchema>;
export const certificateListSchema = z.object({ items: z.array(certificateSchema) });
export type CertificateList = z.infer<typeof certificateListSchema>;
/** Public verification: only the holder's display name, the course and the date. */
export const certificateVerificationSchema = z.object({ valid: z.literal(true), courseTitle: z.string(), holderName: z.string(), issuedAt: z.string() });
export type CertificateVerification = z.infer<typeof certificateVerificationSchema>;

/** Author view: who follows the course and how far they got. */
export const courseStudentsSchema = z.object({
  enrolledCount: z.number().int(),
  completedCount: z.number().int(),
  items: z.array(z.object({ handle: z.string(), displayName: z.string(), progressPercent: z.number().int(), completed: z.boolean() })),
});
export type CourseStudents = z.infer<typeof courseStudentsSchema>;

/** Course reviews (lot 17d): one rating and an optional comment per enrolled learner; the author cannot rate their own course. */
export const courseReviewRequestSchema = z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(500).default('') });
export type CourseReviewRequest = z.infer<typeof courseReviewRequestSchema>;
export const courseReviewSchema = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  body: z.string(),
  author: z.object({ displayName: z.string(), handle: z.string() }),
  mine: z.boolean(),
  createdAt: z.string(),
});
export type CourseReview = z.infer<typeof courseReviewSchema>;
export const courseReviewListSchema = z.object({ items: z.array(courseReviewSchema), nextCursor: z.string().nullable() });
export type CourseReviewList = z.infer<typeof courseReviewListSchema>;
