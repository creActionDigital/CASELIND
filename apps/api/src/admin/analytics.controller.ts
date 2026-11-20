import { Controller, Get, Query } from '@nestjs/common';
import { type AnalyticsOverview, type AnalyticsQuery, analyticsQuerySchema } from '@caselind/contracts';
import { ZodPipe } from '../common/zod.pipe.js';
import { Roles } from '../security/auth.guard.js';
import { AnalyticsService } from './analytics.service.js';

/** Platform analytics: aggregates only, no personal data. Admin role, checked server-side. */
@Controller('admin/analytics')
@Roles('admin')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@Query(new ZodPipe(analyticsQuerySchema)) q: AnalyticsQuery): Promise<AnalyticsOverview> {
    return this.analytics.overview(q.days);
  }
}
