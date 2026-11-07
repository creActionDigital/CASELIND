import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import {
  type OrgLocation,
  type PlaceList,
  type PlacesQuery,
  placesQuerySchema,
  type SetOrgLocationRequest,
  setOrgLocationRequestSchema,
  type UpdateOrgLocationRequest,
  updateOrgLocationRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { PlacesService } from './places.service.js';

/** Lot 7 : places. Behind the `search` flag. */
@Controller()
@RequireFlag('search')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('places')
  nearby(@CurrentUser() user: AuthUser, @Query(new ZodPipe(placesQuerySchema)) query: PlacesQuery): Promise<PlaceList> {
    return this.places.nearby(user.userId, query);
  }

  @Post('orgs/:orgId/location')
  @OrgPermission('org.profile.edit')
  set(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(setOrgLocationRequestSchema)) body: SetOrgLocationRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<OrgLocation> {
    return this.places.setLocation(m.orgId, user.userId, body, meta);
  }

  @Patch('orgs/:orgId/location')
  @OrgPermission('org.profile.edit')
  update(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateOrgLocationRequestSchema)) body: UpdateOrgLocationRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<OrgLocation> {
    return this.places.updateLocation(m.orgId, user.userId, body, meta);
  }

  @Delete('orgs/:orgId/location')
  @OrgPermission('org.profile.edit')
  @HttpCode(204)
  async remove(@CurrentMembership() m: OrgMembership, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.places.removeLocation(m.orgId, user.userId, meta);
  }
}
