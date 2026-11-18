import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateHealthResultRequest,
  createHealthResultRequestSchema,
  type HealthResult,
  type HealthResultList,
  type HealthResultListQuery,
  healthResultListQuerySchema,
  type SharedResults,
  type UpdateHealthResultRequest,
  updateHealthResultRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { HealthResultsService } from './health-results.service.js';

/** Exam results (lot 18d). Behind the regulated `health` flag; the patient's own, plus the professional side. */
@Controller()
@RequireFlag('health')
export class HealthResultsController {
  constructor(private readonly results: HealthResultsService) {}

  @Get('me/health/results')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(healthResultListQuerySchema)) q: HealthResultListQuery): Promise<HealthResultList> {
    return this.results.list(u.userId, q);
  }

  @Post('me/health/results')
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createHealthResultRequestSchema)) b: CreateHealthResultRequest, @ReqMeta() meta: RequestMeta): Promise<HealthResult> {
    return this.results.create(u.userId, b, meta);
  }

  @Patch('me/health/results/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateHealthResultRequestSchema)) b: UpdateHealthResultRequest, @ReqMeta() meta: RequestMeta): Promise<HealthResult> {
    return this.results.update(u.userId, id, b, meta);
  }

  @Delete('me/health/results/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.results.remove(u.userId, id, meta);
  }

  /** A professional reads the results a patient shared (active share covering `results`). */
  @Get('health/patients/:patientId/results')
  shared(@CurrentUser() u: AuthUser, @Param('patientId') patientId: string, @ReqMeta() meta: RequestMeta): Promise<SharedResults> {
    return this.results.readShared(u.userId, patientId, meta);
  }

  /** A verified professional with a confirmed or completed appointment adds a result for that patient. */
  @Post('health/patients/:patientId/results')
  async add(@CurrentUser() u: AuthUser, @Param('patientId') patientId: string, @Body(new ZodPipe(createHealthResultRequestSchema)) b: CreateHealthResultRequest, @ReqMeta() meta: RequestMeta): Promise<{ id: string }> {
    return this.results.createFor(u.userId, patientId, b, meta);
  }
}
