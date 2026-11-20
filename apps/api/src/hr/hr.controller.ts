import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  type CreateLeaveRequest,
  createLeaveRequestSchema,
  type CreateShiftRequest,
  createShiftRequestSchema,
  type DecideLeaveRequest,
  decideLeaveRequestSchema,
  type EmployeeDetail,
  type EmployeeList,
  type LeaveList,
  type LeaveListQuery,
  leaveListQuerySchema,
  type LeaveRequest,
  type MyLeaves,
  type MyOrgQuery,
  myOrgQuerySchema,
  type MyShiftListQuery,
  myShiftListQuerySchema,
  type SalaryLine,
  type SalaryList,
  type SalaryListQuery,
  salaryListQuerySchema,
  type SaveEmployeeProfileRequest,
  saveEmployeeProfileRequestSchema,
  type SaveSalaryLineRequest,
  saveSalaryLineRequestSchema,
  type Shift,
  type ShiftList,
  type ShiftListQuery,
  shiftListQuerySchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { HrService } from './hr.service.js';

const caller = (m: OrgMembership, u: AuthUser) => ({ userId: u.userId, role: m.role });

/**
 * Staff side of HR. `org.view` routes decide in the service (HR, the employee, or the employee's direct manager):
 * an employee never decides their own leave, and the HR note never leaves HR.
 */
@Controller('orgs/:orgId/hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get('employees')
  @OrgPermission('hr.manage')
  employees(@CurrentMembership() m: OrgMembership): Promise<EmployeeList> {
    return this.hr.listEmployees(m.orgId);
  }

  @Get('employees/:userId')
  @OrgPermission('org.view')
  employee(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('userId') userId: string): Promise<EmployeeDetail> {
    return this.hr.getEmployee(m.orgId, caller(m, u), userId);
  }

  @Put('employees/:userId')
  @OrgPermission('hr.manage')
  saveEmployee(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('userId') userId: string, @Body(new ZodPipe(saveEmployeeProfileRequestSchema)) b: SaveEmployeeProfileRequest, @ReqMeta() meta: RequestMeta): Promise<EmployeeDetail> {
    return this.hr.saveProfile(m.orgId, caller(m, u), userId, b, meta);
  }

  @Get('leaves')
  @OrgPermission('org.view')
  leaves(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Query(new ZodPipe(leaveListQuerySchema)) q: LeaveListQuery): Promise<LeaveList> {
    return this.hr.listLeaves(m.orgId, caller(m, u), q);
  }

  @Post('leaves')
  @OrgPermission('org.view')
  requestLeave(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createLeaveRequestSchema)) b: CreateLeaveRequest, @ReqMeta() meta: RequestMeta): Promise<LeaveRequest> {
    return this.hr.requestLeave(m.orgId, u.userId, b, meta);
  }

  @Post('leaves/:id/cancel')
  @HttpCode(200)
  @OrgPermission('org.view')
  cancelLeave(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<LeaveRequest> {
    return this.hr.cancelLeave(m.orgId, u.userId, id, meta);
  }

  @Post('leaves/:id/decision')
  @HttpCode(200)
  @OrgPermission('org.view')
  decideLeave(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(decideLeaveRequestSchema)) b: DecideLeaveRequest, @ReqMeta() meta: RequestMeta): Promise<LeaveRequest> {
    return this.hr.decideLeave(m.orgId, caller(m, u), id, b, meta);
  }

  @Get('shifts')
  @OrgPermission('org.view')
  shifts(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Query(new ZodPipe(shiftListQuerySchema)) q: ShiftListQuery): Promise<ShiftList> {
    return this.hr.listShifts(m.orgId, caller(m, u), q);
  }

  @Post('shifts')
  @OrgPermission('org.view')
  createShift(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createShiftRequestSchema)) b: CreateShiftRequest, @ReqMeta() meta: RequestMeta): Promise<Shift> {
    return this.hr.createShift(m.orgId, caller(m, u), b, meta);
  }

  @Delete('shifts/:id')
  @HttpCode(204)
  @OrgPermission('org.view')
  deleteShift(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.hr.deleteShift(m.orgId, caller(m, u), id, meta);
  }

  @Get('salary')
  @OrgPermission('payroll.manage')
  salary(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(salaryListQuerySchema)) q: SalaryListQuery): Promise<SalaryList> {
    return this.hr.listSalary(m.orgId, q);
  }

  @Put('salary')
  @OrgPermission('payroll.manage')
  saveSalary(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(saveSalaryLineRequestSchema)) b: SaveSalaryLineRequest, @ReqMeta() meta: RequestMeta): Promise<SalaryLine> {
    return this.hr.saveSalary(m.orgId, u.userId, b, meta);
  }

  @Delete('salary/:id')
  @HttpCode(204)
  @OrgPermission('payroll.manage')
  deleteSalary(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.hr.deleteSalary(m.orgId, u.userId, id, meta);
  }
}

/** Employee side: only the caller's own data, in an organisation they actively belong to (404 otherwise). */
@Controller('me/hr')
export class MyHrController {
  constructor(private readonly hr: HrService) {}

  @Get('leaves')
  leaves(@CurrentUser() u: AuthUser, @Query(new ZodPipe(myOrgQuerySchema)) q: MyOrgQuery): Promise<MyLeaves> {
    return this.hr.myLeaves(q.orgId, u.userId);
  }

  @Get('shifts')
  shifts(@CurrentUser() u: AuthUser, @Query(new ZodPipe(myShiftListQuerySchema)) q: MyShiftListQuery): Promise<ShiftList> {
    return this.hr.myShifts(q.orgId, u.userId, q.from, q.to);
  }

  @Get('salary')
  salary(@CurrentUser() u: AuthUser, @Query(new ZodPipe(myOrgQuerySchema)) q: MyOrgQuery): Promise<SalaryList> {
    return this.hr.mySalary(q.orgId, u.userId);
  }
}
