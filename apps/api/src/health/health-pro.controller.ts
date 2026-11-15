import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  type AccessLog,
  type AdminProfessionalList,
  type AdminProfessionalsQuery,
  adminProfessionalsQuerySchema,
  type ApplyProfessionalRequest,
  applyProfessionalRequestSchema,
  type Appointment,
  type AppointmentList,
  type CreateAppointmentRequest,
  createAppointmentRequestSchema,
  type CreatePrescriptionRequest,
  createPrescriptionRequestSchema,
  type CreateShareRequest,
  createShareRequestSchema,
  type MyProfessional,
  type PageQuery,
  pageQuerySchema,
  type Prescription,
  type PrescriptionList,
  type ProfessionalList,
  type ProfessionalListQuery,
  professionalListQuerySchema,
  type ReviewProfessionalRequest,
  reviewProfessionalRequestSchema,
  type Share,
  type ShareList,
  type SharedPatients,
  type SharedRecord,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { HealthProService } from './health-pro.service.js';

/** Professionals, appointments, sharing and prescriptions. Behind the regulated `health` flag. */
@Controller()
@RequireFlag('health')
export class HealthProController {
  constructor(private readonly pro: HealthProService) {}

  @Get('health-professionals')
  directory(@CurrentUser() u: AuthUser, @Query(new ZodPipe(professionalListQuerySchema)) q: ProfessionalListQuery): Promise<ProfessionalList> {
    return this.pro.directory(u.userId, q);
  }

  @Get('me/health/professional')
  mine(@CurrentUser() u: AuthUser): Promise<MyProfessional> {
    return this.pro.mine(u.userId);
  }

  @Put('me/health/professional')
  apply(@CurrentUser() u: AuthUser, @Body(new ZodPipe(applyProfessionalRequestSchema)) b: ApplyProfessionalRequest, @ReqMeta() meta: RequestMeta): Promise<MyProfessional> {
    return this.pro.apply(u.userId, b, meta);
  }

  @Post('me/health/appointments')
  book(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createAppointmentRequestSchema)) b: CreateAppointmentRequest, @ReqMeta() meta: RequestMeta): Promise<Appointment> {
    return this.pro.book(u.userId, b, meta);
  }

  @Get('me/health/appointments')
  asPatient(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<AppointmentList> {
    return this.pro.myAppointments(u.userId, 'patient', q);
  }

  @Get('me/health/professional/appointments')
  asProfessional(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<AppointmentList> {
    return this.pro.myAppointments(u.userId, 'professional', q);
  }

  @Post('health/appointments/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Appointment> {
    return this.pro.act(u.userId, id, 'confirm', meta);
  }

  @Post('health/appointments/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Appointment> {
    return this.pro.act(u.userId, id, 'decline', meta);
  }

  @Post('health/appointments/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Appointment> {
    return this.pro.act(u.userId, id, 'cancel', meta);
  }

  @Post('health/appointments/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Appointment> {
    return this.pro.act(u.userId, id, 'complete', meta);
  }

  @Post('me/health/shares')
  share(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createShareRequestSchema)) b: CreateShareRequest, @ReqMeta() meta: RequestMeta): Promise<Share> {
    return this.pro.share(u.userId, b, meta);
  }

  @Get('me/health/shares')
  shares(@CurrentUser() u: AuthUser): Promise<ShareList> {
    return this.pro.myShares(u.userId);
  }

  @Delete('me/health/shares/:id')
  revoke(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Share> {
    return this.pro.revokeShare(u.userId, id, meta);
  }

  @Get('me/health/access-log')
  accessLog(@CurrentUser() u: AuthUser): Promise<AccessLog> {
    return this.pro.accessLog(u.userId);
  }

  @Get('me/health/professional/patients')
  patients(@CurrentUser() u: AuthUser): Promise<SharedPatients> {
    return this.pro.sharedPatients(u.userId);
  }

  @Get('me/health/professional/patients/:patientId/record')
  record(@CurrentUser() u: AuthUser, @Param('patientId') patientId: string, @ReqMeta() meta: RequestMeta): Promise<SharedRecord> {
    return this.pro.readSharedRecord(u.userId, patientId, meta);
  }

  @Post('me/health/professional/appointments/:id/prescription')
  prescribe(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createPrescriptionRequestSchema)) b: CreatePrescriptionRequest, @ReqMeta() meta: RequestMeta): Promise<Prescription> {
    return this.pro.prescribe(u.userId, id, b, meta);
  }

  @Get('me/health/prescriptions')
  prescriptions(@CurrentUser() u: AuthUser): Promise<PrescriptionList> {
    return this.pro.myPrescriptions(u.userId);
  }
}

/** Platform administrators verify the professionals' licences. */
@Controller('admin/health')
@RequireFlag('health')
@Roles('admin')
export class AdminHealthController {
  constructor(private readonly pro: HealthProService) {}

  @Get('professionals')
  list(@Query(new ZodPipe(adminProfessionalsQuerySchema)) q: AdminProfessionalsQuery): Promise<AdminProfessionalList> {
    return this.pro.adminList(q);
  }

  @Post('professionals/:userId/review')
  @HttpCode(204)
  async review(@CurrentUser() u: AuthUser, @Param('userId') userId: string, @Body(new ZodPipe(reviewProfessionalRequestSchema)) b: ReviewProfessionalRequest, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.pro.review(u.userId, userId, b, meta);
  }
}
