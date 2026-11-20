import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AiAction, AiActionList, AiActionOutcome } from '@caselind/contracts';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { AiActionsService } from './ai-actions.service.js';

/** Handler name the AI throttler applies to (a confirmation can call the provider, e.g. a summary). */
export const AI_CONFIRM_HANDLER = 'confirmAction';

/** Actions proposed by the assistant: listed, confirmed or dismissed by their owner only (others: 404). */
@Controller()
@RequireFlag('ai')
export class AiActionsController {
  constructor(private readonly actions: AiActionsService) {}

  @Get('ai/conversations/:id/actions')
  async pending(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AiActionList> {
    return { items: await this.actions.pending(user.userId, id) };
  }

  @Post('ai/actions/:id/confirm')
  @HttpCode(200)
  confirmAction(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AiActionOutcome> {
    return this.actions.confirm(user.userId, id);
  }

  @Post('ai/actions/:id/dismiss')
  @HttpCode(200)
  dismiss(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<AiAction> {
    return this.actions.dismiss(user.userId, id);
  }
}
