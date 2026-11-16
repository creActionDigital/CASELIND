import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type CertificateList,
  type CertificateVerification,
  type CourseDetail,
  type CourseList,
  type CourseListQuery,
  type CourseReviewList,
  type CourseReviewRequest,
  courseReviewRequestSchema,
  courseListQuerySchema,
  type CourseStudents,
  type CreateCourseRequest,
  createCourseRequestSchema,
  type EnrollmentList,
  type PageQuery,
  pageQuerySchema,
  type Quiz,
  type QuizAttemptRequest,
  quizAttemptRequestSchema,
  type QuizResult,
  type SetLessonsRequest,
  setLessonsRequestSchema,
  type SetQuizRequest,
  setQuizRequestSchema,
  type UpdateCourseRequest,
  updateCourseRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser, Public } from '../security/auth.guard.js';
import { EducationService } from './education.service.js';

/** Education for any signed-in user (author on one course, learner on another). Behind the `education` flag. */
@Controller()
@RequireFlag('education')
export class EducationController {
  constructor(private readonly edu: EducationService) {}

  @Get('courses')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(courseListQuerySchema)) q: CourseListQuery): Promise<CourseList> {
    return this.edu.list(u.userId, q);
  }

  @Get('me/courses')
  mine(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<CourseList> {
    return this.edu.mine(u.userId, q);
  }

  @Post('courses')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createCourseRequestSchema)) b: CreateCourseRequest, @ReqMeta() meta: RequestMeta): Promise<CourseDetail> {
    return this.edu.create(u.userId, b, meta);
  }

  @Get('courses/:id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<CourseDetail> {
    return this.edu.get(u.userId, id);
  }

  @Patch('courses/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateCourseRequestSchema)) b: UpdateCourseRequest): Promise<CourseDetail> {
    return this.edu.update(u.userId, id, b);
  }

  @Put('courses/:id/lessons')
  setLessons(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(setLessonsRequestSchema)) b: SetLessonsRequest): Promise<CourseDetail> {
    return this.edu.setLessons(u.userId, id, b);
  }

  @Put('courses/:id/quiz')
  setQuiz(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(setQuizRequestSchema)) b: SetQuizRequest): Promise<CourseDetail> {
    return this.edu.setQuiz(u.userId, id, b);
  }

  @Post('courses/:id/publish')
  @HttpCode(200)
  publish(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CourseDetail> {
    return this.edu.setPublished(u.userId, id, true, meta);
  }

  @Post('courses/:id/unpublish')
  @HttpCode(200)
  unpublish(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CourseDetail> {
    return this.edu.setPublished(u.userId, id, false, meta);
  }

  @Get('courses/:id/students')
  students(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<CourseStudents> {
    return this.edu.students(u.userId, id);
  }

  @Post('courses/:id/enroll')
  @HttpCode(200)
  enroll(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<CourseDetail> {
    return this.edu.enroll(u.userId, id, meta);
  }

  @Post('courses/:id/lessons/:lessonId/complete')
  @HttpCode(200)
  complete(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('lessonId') lessonId: string, @ReqMeta() meta: RequestMeta): Promise<CourseDetail> {
    return this.edu.completeLesson(u.userId, id, lessonId, meta);
  }

  @Get('courses/:id/quiz')
  quiz(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Quiz> {
    return this.edu.quiz(u.userId, id);
  }

  @Post('courses/:id/quiz/attempts')
  @HttpCode(200)
  attempt(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(quizAttemptRequestSchema)) b: QuizAttemptRequest, @ReqMeta() meta: RequestMeta): Promise<QuizResult> {
    return this.edu.attempt(u.userId, id, b, meta);
  }

  @Get('courses/:id/reviews')
  reviews(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<CourseReviewList> {
    return this.edu.reviews(u.userId, id, q);
  }

  @Put('courses/:id/reviews/me')
  saveReview(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(courseReviewRequestSchema)) b: CourseReviewRequest, @ReqMeta() meta: RequestMeta): Promise<CourseDetail> {
    return this.edu.saveReview(u.userId, id, b, meta);
  }

  @Delete('courses/:id/reviews/me')
  @HttpCode(204)
  deleteReview(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.edu.deleteReview(u.userId, id, meta);
  }

  @Get('me/enrollments')
  enrollments(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<EnrollmentList> {
    return this.edu.myEnrollments(u.userId, q);
  }

  @Get('me/certificates')
  certificates(@CurrentUser() u: AuthUser): Promise<CertificateList> {
    return this.edu.myCertificates(u.userId);
  }
}

/** Anyone with a certificate code can check it, without a token (CDC §13: certificates). Not behind the flag, a certificate stays verifiable. */
@Controller('public/certificates')
export class PublicCertificatesController {
  constructor(private readonly edu: EducationService) {}

  @Get(':code')
  @Public()
  verify(@Param('code') code: string): Promise<CertificateVerification> {
    return this.edu.verify(code);
  }
}
