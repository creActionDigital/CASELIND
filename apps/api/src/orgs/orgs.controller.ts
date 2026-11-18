import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  type CreateOrgRequest,
  createOrgRequestSchema,
  type InviteOrgMemberRequest,
  inviteOrgMemberRequestSchema,
  type MyOrgMembership,
  type OrgGallery,
  type SetOrgGalleryRequest,
  setOrgGalleryRequestSchema,
  type Org,
  type OrgMember,
  type OrgMemberList,
  type OrgMemberListQuery,
  orgMemberListQuerySchema,
  type PublicOrg,
  type UpdateOrgMemberRequest,
  updateOrgMemberRequestSchema,
  type UpdateOrgRequest,
  updateOrgRequestSchema,
} from '@caselind/contracts';
import type { Request } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Public } from '../security/auth.guard.js';
import { SessionVerifier } from '../security/session-verifier.js';
import { AllowSelfLeaveWhenSuspended, CurrentMembership, type OrgMembership, OrgPermission } from './org.guard.js';
import { OrgMembersService } from './org-members.service.js';
import { OrgsService } from './orgs.service.js';

/**
 * Organisation routes. Every `:orgId` route carries @OrgPermission, which 404s non-members (a
 * private org is never revealed) and 403s members whose role lacks the permission.
 * Malformed `:userId` values are 404 like unknown members (checked in the service).
 */
@Controller('orgs')
export class OrgsController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly members: OrgMembersService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createOrgRequestSchema)) body: CreateOrgRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Org> {
    return this.orgs.create(user.userId, body, meta);
  }

  @Get(':orgId')
  @OrgPermission('org.view')
  get(@CurrentMembership() m: OrgMembership): Promise<Org> {
    return this.orgs.get(m.orgId);
  }

  @Patch(':orgId')
  @OrgPermission('org.profile.edit')
  update(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateOrgRequestSchema)) body: UpdateOrgRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Org> {
    return this.orgs.update(m.orgId, user.userId, body, meta);
  }

  @Get(':orgId/gallery')
  @OrgPermission('org.view')
  gallery(@CurrentMembership() m: OrgMembership): Promise<OrgGallery> {
    return this.orgs.getGallery(m.orgId);
  }

  @Put(':orgId/gallery')
  @OrgPermission('org.profile.edit')
  setGallery(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(setOrgGalleryRequestSchema)) body: SetOrgGalleryRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<OrgGallery> {
    return this.orgs.setGallery(m.orgId, user.userId, body.assetIds, meta);
  }

  @Get(':orgId/members')
  @OrgPermission('org.members.view')
  listMembers(
    @CurrentMembership() m: OrgMembership,
    @Query(new ZodPipe(orgMemberListQuerySchema)) query: OrgMemberListQuery,
  ): Promise<OrgMemberList> {
    return this.members.list(m.orgId, query);
  }

  @Post(':orgId/invitations')
  @OrgPermission('org.members.manage')
  invite(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(inviteOrgMemberRequestSchema)) body: InviteOrgMemberRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<OrgMember> {
    return this.members.invite(m.orgId, user.userId, body, meta);
  }

  @Patch(':orgId/members/:userId')
  @OrgPermission('org.members.manage')
  changeRole(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body(new ZodPipe(updateOrgMemberRequestSchema)) body: UpdateOrgMemberRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<OrgMember> {
    return this.members.changeRole(m.orgId, user.userId, userId, body.role, meta);
  }

  /** Any member may remove themselves (leave); removing others is checked in the service. */
  @Delete(':orgId/members/:userId')
  @OrgPermission('org.view')
  @AllowSelfLeaveWhenSuspended()
  @HttpCode(204)
  async removeMember(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.members.remove(m.orgId, user.userId, userId, meta);
  }
}

/** The caller's side: memberships and invitations addressed to them. */
@Controller('me')
export class MyOrgsController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly members: OrgMembersService,
  ) {}

  @Get('orgs')
  myOrgs(@CurrentUser() user: AuthUser): Promise<{ items: MyOrgMembership[] }> {
    return this.orgs.myOrgs(user.userId);
  }

  @Post('org-invitations/:orgId/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('orgId') orgId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MyOrgMembership> {
    return this.members.accept(orgId, user.userId, meta);
  }

  @Post('org-invitations/:orgId/decline')
  @HttpCode(204)
  async decline(
    @CurrentUser() user: AuthUser,
    @Param('orgId') orgId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.members.decline(orgId, user.userId, meta);
  }
}

/** Storefront pages (CDC §5): no token required so they can be indexed and shared. */
@Controller('public/orgs')
export class PublicOrgsController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly verifier: SessionVerifier,
  ) {}

  /** No token needed; a valid one only lets `contactUserId` skip members blocked with the caller. */
  @Get(':slug')
  @Public()
  async storefront(@Param('slug') slug: string, @Req() req: Request): Promise<PublicOrg> {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    const viewer = scheme === 'Bearer' && token ? await this.verifier.verify(token) : null;
    return this.orgs.publicBySlug(slug, viewer?.userId ?? null);
  }
}
