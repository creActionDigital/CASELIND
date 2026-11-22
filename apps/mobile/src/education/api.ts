import {
  certificateListSchema,
  certificateVerificationSchema,
  courseDetailSchema,
  courseListSchema,
  courseReviewListSchema,
  courseStudentsSchema,
  enrollmentListSchema,
  examHistorySchema,
  examResultSchema,
  examSessionSchema,
  quizResultSchema,
  quizSchema,
  type CourseLevel,
  type CourseReviewRequest,
  type CreateCourseRequest,
  type SetLessonsRequest,
  type SetQuizRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

export interface CourseFilters {
  level?: CourseLevel;
  q?: string;
}

export const eduKeys = {
  all: ['education'] as const,
  list: (f: CourseFilters) => ['education', 'list', f] as const,
  course: (id: string) => ['education', 'course', id] as const,
  quiz: (id: string) => ['education', 'quiz', id] as const,
  enrollments: ['education', 'enrollments'] as const,
  authored: ['education', 'authored'] as const,
  certificates: ['education', 'certificates'] as const,
  reviews: (id: string) => ['education', 'reviews', id] as const,
  exam: (id: string) => ['education', 'exam', id] as const,
  students: (id: string) => ['education', 'students', id] as const,
};

export const fetchCourses = (f: CourseFilters, cursor?: string) => api.request('/courses', { query: { level: f.level, q: f.q || undefined, limit: PAGE, cursor }, schema: courseListSchema });
export const fetchCourse = (id: string) => api.request(`/courses/${id}`, { schema: courseDetailSchema });
export const createCourse = (body: CreateCourseRequest) => api.request('/courses', { method: 'POST', body, schema: courseDetailSchema });
export const saveLessons = (id: string, body: SetLessonsRequest) => api.request(`/courses/${id}/lessons`, { method: 'PUT', body, schema: courseDetailSchema });
export const saveQuiz = (id: string, body: SetQuizRequest) => api.request(`/courses/${id}/quiz`, { method: 'PUT', body, schema: courseDetailSchema });
export const setPublished = (id: string, published: boolean) => api.request(`/courses/${id}/${published ? 'publish' : 'unpublish'}`, { method: 'POST', schema: courseDetailSchema });
export const fetchStudents = (id: string) => api.request(`/courses/${id}/students`, { schema: courseStudentsSchema });
export const enrollInCourse = (id: string) => api.request(`/courses/${id}/enroll`, { method: 'POST', schema: courseDetailSchema });
export const completeLesson = (id: string, lessonId: string) => api.request(`/courses/${id}/lessons/${lessonId}/complete`, { method: 'POST', schema: courseDetailSchema });
export const fetchQuiz = (id: string) => api.request(`/courses/${id}/quiz`, { schema: quizSchema });
export const submitQuiz = (id: string, answers: number[]) => api.request(`/courses/${id}/quiz/attempts`, { method: 'POST', body: { answers }, schema: quizResultSchema });
export const fetchMyCourses = (cursor?: string) => api.request('/me/courses', { query: { limit: PAGE, cursor }, schema: courseListSchema });
export const fetchEnrollments = (cursor?: string) => api.request('/me/enrollments', { query: { limit: PAGE, cursor }, schema: enrollmentListSchema });
export const fetchCertificates = () => api.request('/me/certificates', { schema: certificateListSchema });
export const verifyCertificate = (code: string) => api.request(`/public/certificates/${encodeURIComponent(code)}`, { schema: certificateVerificationSchema });
export const fetchReviews = (id: string, cursor?: string) => api.request(`/courses/${id}/reviews`, { query: { limit: 50, cursor }, schema: courseReviewListSchema });
export const saveReview = (id: string, body: CourseReviewRequest) => api.request(`/courses/${id}/reviews/me`, { method: 'PUT', body, schema: courseDetailSchema });
export const deleteReview = (id: string) => api.request(`/courses/${id}/reviews/me`, { method: 'DELETE' });
export const saveExam = (id: string, examMinutes: number | null) => api.request(`/courses/${id}/exam`, { method: 'PUT', body: { examMinutes }, schema: courseDetailSchema });
export const startExam = (id: string) => api.request(`/courses/${id}/exam/sessions`, { method: 'POST', schema: examSessionSchema });
export const submitExam = (id: string, sid: string, answers: number[]) => api.request(`/courses/${id}/exam/sessions/${sid}/answers`, { method: 'POST', body: { answers }, schema: examResultSchema });
export const fetchExamHistory = (id: string) => api.request(`/courses/${id}/exam/attempts`, { schema: examHistorySchema });

export const setLessonFiles = (id: string, lessonId: string, assetIds: string[]) =>
  api.request(`/courses/${id}/lessons/${lessonId}/files`, { method: 'PUT', body: { assetIds }, schema: courseDetailSchema });
