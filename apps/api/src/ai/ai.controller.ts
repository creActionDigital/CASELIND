import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  type AdminAiModel,
  type AdminAiModelList,
  type AiConversation,
  type AiConversationList,
  type AiMessageList,
  type AiModelList,
  type AiSettings,
  type CreateAiConversationRequest,
  createAiConversationRequestSchema,
  type ProductDescriptionRequest,
  type ProductDescriptionResult,
  productDescriptionRequestSchema,
  type SendAiMessageRequest,
  type SendAiMessageResult,
  sendAiMessageRequestSchema,
  type UpdateAiModelRequest,
  updateAiModelRequestSchema,
  type UpdateAiSettingsRequest,
  updateAiSettingsRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { OrgPermission } from '../orgs/org.guard.js';
import { type AuthUser, CurrentUser, Roles } from '../security/auth.guard.js';
import { AiModelsService } from './ai-models.service.js';
import { AiService } from './ai.service.js';

/** Handler names the stricter AI throttler applies to (see app.module). */
export const AI_SEND_HANDLER = 'sendMessage';
export const AI_DESCRIPTION_HANDLER = 'productDescription';

/** Assistant for users. Flag `ai`. Conversations are private to their owner (foreign ids: 404). */
@Controller()
@RequireFlag('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('ai/models')
  models(): Promise<AiModelList> {
    return this.ai.listModels();
  }

  @Get('me/ai-settings')
  settings(@CurrentUser() user: AuthUser): Promise<AiSettings> {
    return this.ai.getSettings(user.userId);
  }

  @Patch('me/ai-settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateAiSettingsRequestSchema)) body: UpdateAiSettingsRequest,
  ): Promise<AiSettings> {
    return this.ai.updateSettings(user.userId, body);
  }

  @Post('ai/conversations')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createAiConversationRequestSchema)) body: CreateAiConversationRequest,
  ): Promise<AiConversation> {
    return this.ai.createConversation(user.userId, body.title);
  }

  @Get('ai/conversations')
  list(@CurrentUser() user: AuthUser): Promise<AiConversationList> {
    return this.ai.listConversations(user.userId);
  }

  @Get('ai/conversations/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AiMessageList> {
    return this.ai.listMessages(user.userId, id);
  }

  @Post('ai/conversations/:id/messages')
  @HttpCode(201)
  sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(sendAiMessageRequestSchema)) body: SendAiMessageRequest,
  ): Promise<SendAiMessageResult> {
    return this.ai.sendMessage(user.userId, id, body.content);
  }

  @Delete('ai/conversations/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.ai.deleteConversation(user.userId, id);
  }
}

/** Seller help: a draft description to proofread; never stored nor published by the server. */
@Controller()
@RequireFlag('ai')
export class OrgAiController {
  constructor(private readonly ai: AiService) {}

  @Post('orgs/:orgId/ai/product-description')
  @HttpCode(200)
  @OrgPermission('catalog.manage')
  productDescription(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(productDescriptionRequestSchema)) body: ProductDescriptionRequest,
  ): Promise<ProductDescriptionResult> {
    return this.ai.productDescription(user.userId, body);
  }
}

/** Model activation. `admin` role; every change is audited. */
@Controller('admin/ai')
@Roles('admin')
export class AdminAiController {
  constructor(private readonly models: AiModelsService) {}

  @Get('models')
  async list(): Promise<AdminAiModelList> {
    return { items: await this.models.adminList() };
  }

  @Patch('models/:modelId')
  update(
    @Param('modelId') modelId: string,
    @Body(new ZodPipe(updateAiModelRequestSchema)) body: UpdateAiModelRequest,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ): Promise<AdminAiModel> {
    return this.models.setEnabled(modelId, body.enabled, user.userId, meta);
  }
}
