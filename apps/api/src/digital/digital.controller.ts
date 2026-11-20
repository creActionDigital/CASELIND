import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { type DownloadList, type ProductFiles, type SetProductFilesRequest, setProductFilesRequestSchema } from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { DigitalProductsService } from './digital.service.js';

@Controller()
@RequireFlag('commerce')
export class DigitalProductsController {
  constructor(private readonly digital: DigitalProductsService) {}

  @Get('orgs/:orgId/products/:productId/files')
  @OrgPermission('catalog.manage')
  files(@CurrentMembership() m: OrgMembership, @Param('productId') productId: string): Promise<ProductFiles> {
    return this.digital.getFiles(m.orgId, productId);
  }

  @Put('orgs/:orgId/products/:productId/files')
  @OrgPermission('catalog.manage')
  setFiles(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body(new ZodPipe(setProductFilesRequestSchema)) body: SetProductFilesRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ProductFiles> {
    return this.digital.setFiles(m.orgId, user.userId, productId, body.assetIds, meta);
  }

  @Get('me/downloads')
  downloads(@CurrentUser() user: AuthUser): Promise<DownloadList> {
    return this.digital.downloads(user.userId);
  }
}
