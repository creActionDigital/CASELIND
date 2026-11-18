import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  type CreateWebhookRequest,
  createWebhookRequestSchema,
  type UpdateWebhookRequest,
  updateWebhookRequestSchema,
  type Webhook,
  type WebhookDelivery,
  type WebhookDeliveryList,
  type WebhookList,
  type WebhookWithSecret,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { WebhookService } from './webhooks.service.js';

/** Outgoing webhooks of an organisation. Owners only (`org.admins.manage`): they send order data out of the platform. */
@Controller('orgs/:orgId/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhookService) {}

  @Get()
  @OrgPermission('org.admins.manage')
  list(@CurrentMembership() m: OrgMembership): Promise<WebhookList> {
    return this.webhooks.list(m.orgId);
  }

  @Post()
  @OrgPermission('org.admins.manage')
  create(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Body(new ZodPipe(createWebhookRequestSchema)) b: CreateWebhookRequest, @ReqMeta() meta: RequestMeta): Promise<WebhookWithSecret> {
    return this.webhooks.create(m.orgId, u.userId, b, meta);
  }

  @Patch(':id')
  @OrgPermission('org.admins.manage')
  update(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateWebhookRequestSchema)) b: UpdateWebhookRequest, @ReqMeta() meta: RequestMeta): Promise<Webhook> {
    return this.webhooks.update(m.orgId, u.userId, id, b, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @OrgPermission('org.admins.manage')
  remove(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    return this.webhooks.remove(m.orgId, u.userId, id, meta);
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  @OrgPermission('org.admins.manage')
  rotate(@CurrentMembership() m: OrgMembership, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<WebhookWithSecret> {
    return this.webhooks.rotateSecret(m.orgId, u.userId, id, meta);
  }

  @Get(':id/deliveries')
  @OrgPermission('org.admins.manage')
  deliveries(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<WebhookDeliveryList> {
    return this.webhooks.deliveries(m.orgId, id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @OrgPermission('org.admins.manage')
  test(@CurrentMembership() m: OrgMembership, @Param('id') id: string): Promise<WebhookDelivery> {
    return this.webhooks.ping(m.orgId, id);
  }
}
