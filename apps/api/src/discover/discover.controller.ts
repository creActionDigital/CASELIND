import { Controller, Get, Query } from '@nestjs/common';
import {
  type DiscoverQuery,
  discoverQuerySchema,
  type RecommendedMerchants,
  type RecommendedPeople,
} from '@caselind/contracts';
import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { DiscoverService } from './discover.service.js';

@Controller()
export class DiscoverController {
  constructor(private readonly discover: DiscoverService) {}

  @Get('discover/people')
  people(@CurrentUser() user: AuthUser, @Query(new ZodPipe(discoverQuerySchema)) q: DiscoverQuery): Promise<RecommendedPeople> {
    return this.discover.people(user.userId, q.limit);
  }

  @Get('discover/merchants')
  merchants(@Query(new ZodPipe(discoverQuerySchema)) q: DiscoverQuery): Promise<RecommendedMerchants> {
    return this.discover.merchants(q.limit);
  }
}
