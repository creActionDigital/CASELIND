import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../security/auth.guard.js';
import { getOpenApiDocument, type OpenApiDocument } from './build.js';

/** Machine-readable API contract for the mobile and web clients. */
@Controller()
@Public()
@SkipThrottle()
export class OpenApiController {
  @Get('openapi.json')
  document(): OpenApiDocument {
    return getOpenApiDocument();
  }
}
