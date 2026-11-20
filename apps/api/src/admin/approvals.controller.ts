import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type AdminApproval, type AdminApprovalList, type AdminApprovalListQuery, adminApprovalListQuerySchema } from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { AdminApprovalsService } from './approvals.service.js';

/** Double validation (CDC §17/§26). Every route requires the `admin` platform role; nobody decides their own request. */
@Controller('admin/approvals')
@Roles('admin')
export class AdminApprovalsController {
  constructor(private readonly approvals: AdminApprovalsService) {}

  @Get()
  list(@Query(new ZodPipe(adminApprovalListQuerySchema)) q: AdminApprovalListQuery): Promise<AdminApprovalList> {
    return this.approvals.list(q.status, q.limit);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminApproval> {
    return this.approvals.approve(id, u.userId, meta);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminApproval> {
    return this.approvals.reject(id, u.userId, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<AdminApproval> {
    return this.approvals.cancel(id, u.userId, meta);
  }
}
