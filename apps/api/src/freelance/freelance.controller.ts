import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AcceptProposalRequest,
  acceptProposalRequestSchema,
  type AdminDispute,
  type AdminDisputeList,
  type AdminDisputesQuery,
  adminDisputesQuerySchema,
  type Contract,
  type ContractList,
  type CreateMissionRequest,
  createMissionRequestSchema,
  type CreateProposalRequest,
  createProposalRequestSchema,
  type DeliverMilestoneRequest,
  deliverMilestoneRequestSchema,
  type Mission,
  type MissionList,
  type MissionListQuery,
  missionListQuerySchema,
  type OpenDisputeRequest,
  openDisputeRequestSchema,
  type PageQuery,
  pageQuerySchema,
  type Proposal,
  type ProposalList,
  type ResolveDisputeRequest,
  resolveDisputeRequestSchema,
  type ReviewContractRequest,
  reviewContractRequestSchema,
  type ReviseMilestoneRequest,
  reviseMilestoneRequestSchema,
  type UpdateMissionRequest,
  updateMissionRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { FreelanceService } from './freelance.service.js';

/** Freelance, for any signed-in user (a user is a client on one mission and a freelancer on another). Behind the `freelance` flag. */
@Controller()
@RequireFlag('freelance')
export class FreelanceController {
  constructor(private readonly f: FreelanceService) {}

  @Get('missions')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(missionListQuerySchema)) q: MissionListQuery): Promise<MissionList> {
    return this.f.listMissions(u.userId, q);
  }

  @Get('me/missions')
  mine(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<MissionList> {
    return this.f.myMissions(u.userId, q);
  }

  @Post('missions')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createMissionRequestSchema)) b: CreateMissionRequest, @ReqMeta() meta: RequestMeta): Promise<Mission> {
    return this.f.createMission(u.userId, b, meta);
  }

  @Get('missions/:id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Mission> {
    return this.f.getMission(u.userId, id);
  }

  @Patch('missions/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateMissionRequestSchema)) b: UpdateMissionRequest, @ReqMeta() meta: RequestMeta): Promise<Mission> {
    return this.f.updateMission(u.userId, id, b, meta);
  }

  @Post('missions/:id/close')
  @HttpCode(200)
  close(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Mission> {
    return this.f.closeMission(u.userId, id, meta);
  }

  @Post('missions/:id/proposals')
  propose(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createProposalRequestSchema)) b: CreateProposalRequest, @ReqMeta() meta: RequestMeta): Promise<Proposal> {
    return this.f.propose(u.userId, id, b, meta);
  }

  @Get('missions/:id/proposals')
  proposals(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<ProposalList> {
    return this.f.missionProposals(u.userId, id, q);
  }

  @Get('me/proposals')
  myProposals(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<ProposalList> {
    return this.f.myProposals(u.userId, q);
  }

  @Post('proposals/:id/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Proposal> {
    return this.f.withdrawProposal(u.userId, id, meta);
  }

  @Post('proposals/:id/accept')
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(acceptProposalRequestSchema)) b: AcceptProposalRequest, @ReqMeta() meta: RequestMeta): Promise<Contract> {
    return this.f.acceptProposal(u.userId, id, b, meta);
  }

  @Get('me/freelance-contracts')
  contracts(@CurrentUser() u: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<ContractList> {
    return this.f.myContracts(u.userId, q);
  }

  @Get('freelance-contracts/:id')
  contract(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Contract> {
    return this.f.getContract(u.userId, id);
  }

  @Post('freelance-contracts/:id/milestones/:mid/deliver')
  @HttpCode(200)
  deliver(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('mid') mid: string, @Body(new ZodPipe(deliverMilestoneRequestSchema)) b: DeliverMilestoneRequest, @ReqMeta() meta: RequestMeta): Promise<Contract> {
    return this.f.deliver(u.userId, id, mid, b.note, meta);
  }

  @Post('freelance-contracts/:id/milestones/:mid/approve')
  @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('mid') mid: string, @ReqMeta() meta: RequestMeta): Promise<Contract> {
    return this.f.approve(u.userId, id, mid, meta);
  }

  @Post('freelance-contracts/:id/milestones/:mid/revision')
  @HttpCode(200)
  revision(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('mid') mid: string, @Body(new ZodPipe(reviseMilestoneRequestSchema)) b: ReviseMilestoneRequest, @ReqMeta() meta: RequestMeta): Promise<Contract> {
    return this.f.requestRevision(u.userId, id, mid, b.note, meta);
  }

  @Post('freelance-contracts/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<Contract> {
    return this.f.cancel(u.userId, id, meta);
  }

  @Post('freelance-contracts/:id/review')
  review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reviewContractRequestSchema)) b: ReviewContractRequest, @ReqMeta() meta: RequestMeta): Promise<Contract> {
    return this.f.review(u.userId, id, b, meta);
  }

  @Post('freelance-contracts/:id/dispute')
  dispute(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(openDisputeRequestSchema)) b: OpenDisputeRequest, @ReqMeta() meta: RequestMeta): Promise<Contract> {
    return this.f.openDispute(u.userId, id, b, meta);
  }
}

/** Platform admin: freelance disputes. Server-side `admin` role. */
@Controller('admin/freelance')
@RequireFlag('freelance')
@Roles('admin')
export class AdminFreelanceController {
  constructor(private readonly f: FreelanceService) {}

  @Get('disputes')
  list(@Query(new ZodPipe(adminDisputesQuerySchema)) q: AdminDisputesQuery): Promise<AdminDisputeList> {
    return this.f.adminDisputes(q);
  }

  @Post('disputes/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(resolveDisputeRequestSchema)) b: ResolveDisputeRequest, @ReqMeta() meta: RequestMeta): Promise<AdminDispute> {
    return this.f.resolveDispute(u.userId, id, b, meta);
  }
}
