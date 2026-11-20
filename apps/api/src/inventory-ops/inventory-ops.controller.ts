import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type Batch,
  type BatchList,
  type CloseInventoryCountRequest,
  closeInventoryCountRequestSchema,
  type ConsumeBatchRequest,
  consumeBatchRequestSchema,
  type CreateBatchRequest,
  createBatchRequestSchema,
  type ExpiringList,
  type ExpiringQuery,
  expiringQuerySchema,
  type Fefo,
  type FefoQuery,
  fefoQuerySchema,
  type InventoryCountDetail,
  type InventoryCountList,
  type OpenInventoryCountRequest,
  openInventoryCountRequestSchema,
  type PatchBatchRequest,
  patchBatchRequestSchema,
  type PutCountLinesRequest,
  putCountLinesRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { BatchesService } from './batches.service.js';
import { InventoryCountsService } from './inventory-counts.service.js';

/** Batches, expiry and physical inventory: permission `inventory.manage`, behind the `commerce` flag like the stock itself. */
@Controller('orgs/:orgId')
@RequireFlag('commerce')
export class InventoryOpsController {
  constructor(
    private readonly batches: BatchesService,
    private readonly counts: InventoryCountsService,
  ) {}

  @Get('variants/:variantId/batches')
  @OrgPermission('inventory.manage')
  listBatches(@CurrentMembership() m: OrgMembership, @Param('variantId') variantId: string): Promise<BatchList> {
    return this.batches.list(m.orgId, variantId);
  }

  @Post('variants/:variantId/batches')
  @OrgPermission('inventory.manage')
  createBatch(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('variantId') variantId: string, @Body(new ZodPipe(createBatchRequestSchema)) b: CreateBatchRequest, @ReqMeta() meta: RequestMeta): Promise<Batch> {
    return this.batches.create(m.orgId, u.userId, variantId, b, meta);
  }

  // Declared before `:batchId` routes so `fefo` is never read as a batch id.
  @Get('variants/:variantId/batches/fefo')
  @OrgPermission('inventory.manage')
  fefo(@CurrentMembership() m: OrgMembership, @Param('variantId') variantId: string, @Query(new ZodPipe(fefoQuerySchema)) q: FefoQuery): Promise<Fefo> {
    return this.batches.fefo(m.orgId, variantId, q.quantity);
  }

  @Patch('variants/:variantId/batches/:batchId')
  @OrgPermission('inventory.manage')
  patchBatch(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('variantId') variantId: string, @Param('batchId') batchId: string, @Body(new ZodPipe(patchBatchRequestSchema)) b: PatchBatchRequest, @ReqMeta() meta: RequestMeta): Promise<Batch> {
    return this.batches.patch(m.orgId, u.userId, variantId, batchId, b, meta);
  }

  @Post('variants/:variantId/batches/:batchId/consume')
  @HttpCode(200)
  @OrgPermission('inventory.manage')
  consume(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('variantId') variantId: string, @Param('batchId') batchId: string, @Body(new ZodPipe(consumeBatchRequestSchema)) b: ConsumeBatchRequest, @ReqMeta() meta: RequestMeta): Promise<Batch> {
    return this.batches.consume(m.orgId, u.userId, variantId, batchId, b, meta);
  }

  @Get('batches/expiring')
  @OrgPermission('inventory.manage')
  expiring(@CurrentMembership() m: OrgMembership, @Query(new ZodPipe(expiringQuerySchema)) q: ExpiringQuery): Promise<ExpiringList> {
    return this.batches.expiring(m.orgId, q.days);
  }

  @Get('inventory-counts')
  @OrgPermission('inventory.manage')
  listCounts(@CurrentMembership() m: OrgMembership): Promise<InventoryCountList> {
    return this.counts.list(m.orgId);
  }

  @Post('inventory-counts')
  @OrgPermission('inventory.manage')
  openCount(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(openInventoryCountRequestSchema)) b: OpenInventoryCountRequest, @ReqMeta() meta: RequestMeta): Promise<InventoryCountDetail> {
    return this.counts.open(m.orgId, u.userId, b.note, meta);
  }

  @Get('inventory-counts/:id')
  @OrgPermission('inventory.manage')
  count(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<InventoryCountDetail> {
    return this.counts.detail(m.orgId, id);
  }

  @Put('inventory-counts/:id/lines')
  @OrgPermission('inventory.manage')
  putLines(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(putCountLinesRequestSchema)) b: PutCountLinesRequest, @ReqMeta() meta: RequestMeta): Promise<InventoryCountDetail> {
    return this.counts.putLines(m.orgId, u.userId, id, b, meta);
  }

  @Post('inventory-counts/:id/close')
  @HttpCode(200)
  @OrgPermission('inventory.manage')
  close(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(closeInventoryCountRequestSchema)) b: CloseInventoryCountRequest, @ReqMeta() meta: RequestMeta): Promise<InventoryCountDetail> {
    return this.counts.close(m.orgId, u.userId, id, b.apply, meta);
  }

  @Post('inventory-counts/:id/cancel')
  @HttpCode(200)
  @OrgPermission('inventory.manage')
  cancel(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<InventoryCountDetail> {
    return this.counts.cancel(m.orgId, u.userId, id, meta);
  }
}
