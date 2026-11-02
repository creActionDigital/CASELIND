import { Body, Controller, Patch } from '@nestjs/common';
import { type Me, type SetAvatarRequest, setAvatarRequestSchema } from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { MediaService } from './media.service.js';

@Controller('me/avatar')
export class AvatarController {
  constructor(private readonly media: MediaService) {}

  /** Uses a ready `avatar` upload of the caller as profile picture; `{assetId: null}` removes it. */
  @Patch()
  setAvatar(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(setAvatarRequestSchema)) body: SetAvatarRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Me> {
    return this.media.setAvatar(user, body.assetId, meta);
  }
}
