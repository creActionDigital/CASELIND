import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { type TranslateMessageRequest, translateMessageRequestSchema, type TranslationResult } from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { TranslationService } from './translation.service.js';

/** Handler name the dedicated translation throttler applies to. */
export const TRANSLATE_HANDLER = 'translateMessage';

@Controller()
@RequireFlag('ai')
export class TranslationController {
  constructor(private readonly translation: TranslationService) {}

  @Post('messages/:id/translate')
  @HttpCode(200)
  translateMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(translateMessageRequestSchema)) body: TranslateMessageRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<TranslationResult> {
    return this.translation.translate(user.userId, id, body.target, meta);
  }
}
