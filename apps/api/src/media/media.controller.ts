import { pipeline, type Readable } from 'node:stream';
import { Body, Controller, Delete, Get, Headers, HttpCode, Logger, Param, Post, Put, Req, Res } from '@nestjs/common';
import {
  type CreateUploadRequest,
  type CreateUploadResponse,
  createUploadRequestSchema,
  type MediaAsset,
  type MediaAssetPublic,
  mediaKindOf,
} from '@caselind/contracts';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser, Public } from '../security/auth.guard.js';
import { MediaService } from './media.service.js';

/** Handlers under the stricter `media` throttler (app.module.ts): each one costs disk or a row. */
export const MEDIA_THROTTLED_HANDLERS: ReadonlySet<string> = new Set(['createUpload', 'uploadContent', 'reissueToken']);

/** Streams a ready asset with the security headers shared by the private and the public content routes. */
function sendMedia(
  res: Response,
  { asset, stream, filename }: { asset: MediaAsset; stream: Readable; filename: string },
  cacheControl: string,
  logger: Logger,
): void {
  const mime = asset.mime!;
  res.status(200);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(asset.sizeBytes));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${mediaKindOf(mime) === 'document' ? 'attachment' : 'inline'}; filename="${filename}"`);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', `"${asset.sha256}"`);
  // Even if a browser rendered the bytes as a document, nothing in it could run.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  pipeline(stream, res, (err) => {
    if (err) logger.debug({ err, assetId: asset.id }, 'media download interrupted');
  });
}

// :id is validated in the service: a malformed id is a 404 like an unknown or foreign asset.
@Controller('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  createUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createUploadRequestSchema)) body: CreateUploadRequest,
  ): Promise<CreateUploadResponse> {
    return this.media.createUpload(user, body);
  }

  /** A fresh upload token for a pending upload of the caller (the first one expired): 404 / 409 otherwise. */
  @Post('uploads/:id/token')
  @HttpCode(200)
  reissueToken(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<CreateUploadResponse> {
    return this.media.reissueUploadToken(user, id);
  }

  /**
   * Raw body: Nest only registers the JSON and urlencoded parsers, so an application/octet-stream
   * (or image/..., video/...) body is still an unread stream here and is consumed by the service.
   */
  @Put('uploads/:id/content')
  async uploadContent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('x-upload-token') token: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MediaAsset> {
    try {
      return await this.media.receiveContent(user, id, token, req, meta);
    } catch (err) {
      // Refused before the whole body was read: do not keep the connection (and its leftover bytes) alive.
      if (!req.complete) res.setHeader('Connection', 'close');
      throw err;
    }
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<MediaAsset | MediaAssetPublic> {
    return this.media.get(user.userId, id);
  }

  @Get(':id/content')
  async content(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const opened = await this.media.openContent(user.userId, id);
    // Content behind a bearer token: shared caches must not keep it. Assets never change once ready.
    sendMedia(res, opened, 'private, max-age=3600', this.logger);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() user: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.media.delete(user, id, meta);
  }
}

/**
 * Anonymous storefront images: `GET /v1/public/media/:id/content` serves only ready "product" images attached to a
 * published, non-hidden product of an active public organisation (404 otherwise). It has its own, larger rate-limit
 * budget (a catalogue page loads many images) instead of the default one.
 */
@Controller('public/media')
export class PublicMediaController {
  private readonly logger = new Logger(PublicMediaController.name);

  constructor(private readonly media: MediaService) {}

  @Get(':id/content')
  @Public()
  @SkipThrottle({ default: true })
  async content(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const opened = await this.media.openPublicProductContent(id);
    // Shared caches may keep it for a short time only: the product can be unpublished at any moment.
    sendMedia(res, opened, 'public, max-age=300', this.logger);
  }
}
