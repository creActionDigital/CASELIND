import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateOrgUpdateRequest,
  createOrgUpdateRequestSchema,
  type OrgUpdate,
  type OrgUpdateList,
  type OrgUpdateListQuery,
  orgUpdateListQuerySchema,
  type UpdateOrgUpdateRequest,
  updateOrgUpdateRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Public } from '../security/auth.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from './org.guard.js';
import { OrgUpdatesService } from './org-updates.service.js';

/** Staff side: publications, promotions and events of the storefront. */
@Controller('orgs/:orgId/updates')
export class OrgUpdatesController {
  constructor(private readonly updates: OrgUpdatesService) {}

  @Get()
  @OrgPermission('org.view')
  list(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(orgUpdateListQuerySchema)) q: OrgUpdateListQuery): Promise<OrgUpdateList> {
    return this.updates.orgList(m.orgId, q);
  }

  @Post()
  @OrgPermission('org.profile.edit')
  create(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createOrgUpdateRequestSchema)) b: CreateOrgUpdateRequest, @ReqMeta() meta: RequestMeta): Promise<OrgUpdate> {
    return this.updates.create(m.orgId, u.userId, b, meta);
  }

  @Patch(':id')
  @OrgPermission('org.profile.edit')
  update(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateOrgUpdateRequestSchema)) b: UpdateOrgUpdateRequest, @ReqMeta() meta: RequestMeta): Promise<OrgUpdate> {
    return this.updates.update(m.orgId, u.userId, id, b, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @OrgPermission('org.profile.edit')
  remove(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.updates.remove(m.orgId, u.userId, id, meta);
  }
}

/** Public side: no token, so the page can be shared and indexed. */
@Controller('public/orgs')
export class PublicOrgUpdatesController {
  constructor(private readonly updates: OrgUpdatesService) {}

  @Get(':slug/updates')
  @Public()
  list(@Param('slug') slug: string, @Query(new ZodPipe(orgUpdateListQuerySchema)) q: OrgUpdateListQuery): Promise<OrgUpdateList> {
    return this.updates.publicList(slug, q);
  }
}
