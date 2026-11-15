import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type CreateHealthEntryRequest,
  createHealthEntryRequestSchema,
  type CreateReminderRequest,
  createReminderRequestSchema,
  type Dose,
  type DoseList,
  type GrantHealthConsentRequest,
  grantHealthConsentRequestSchema,
  type HealthConsent,
  type HealthEntry,
  type HealthEntryList,
  type HealthEntryListQuery,
  healthEntryListQuerySchema,
  type Reminder,
  type ReminderList,
  type UpdateHealthEntryRequest,
  updateHealthEntryRequestSchema,
  type UpdateReminderRequest,
  updateReminderRequestSchema,
} from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { HealthService } from './health.service.js';

/** Personal health data, private to the caller. The `health` flag is regulated: off until an admin confirms it. */
@Controller('me/health')
@RequireFlag('health')
export class PersonalHealthController {
  constructor(private readonly health: HealthService) {}

  @Get('consent')
  consent(@CurrentUser() u: AuthUser): Promise<HealthConsent> {
    return this.health.consent(u.userId);
  }

  @Put('consent')
  grant(@CurrentUser() u: AuthUser, @Body(new ZodPipe(grantHealthConsentRequestSchema)) b: GrantHealthConsentRequest, @ReqMeta() meta: RequestMeta): Promise<HealthConsent> {
    return this.health.grant(u.userId, b.version, meta);
  }

  @Delete('consent')
  revoke(@CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta): Promise<HealthConsent> {
    return this.health.revoke(u.userId, meta);
  }

  /** Erases every entry, reminder and dose, and the consent. */
  @Delete('data')
  @HttpCode(204)
  async erase(@CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.health.erase(u.userId, meta);
  }

  @Get('entries')
  entries(@CurrentUser() u: AuthUser, @Query(new ZodPipe(healthEntryListQuerySchema)) q: HealthEntryListQuery): Promise<HealthEntryList> {
    return this.health.listEntries(u.userId, q);
  }

  @Post('entries')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createHealthEntryRequestSchema)) b: CreateHealthEntryRequest, @ReqMeta() meta: RequestMeta): Promise<HealthEntry> {
    return this.health.createEntry(u.userId, b, meta);
  }

  @Patch('entries/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateHealthEntryRequestSchema)) b: UpdateHealthEntryRequest, @ReqMeta() meta: RequestMeta): Promise<HealthEntry> {
    return this.health.updateEntry(u.userId, id, b, meta);
  }

  @Delete('entries/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.health.deleteEntry(u.userId, id, meta);
  }

  @Get('reminders')
  reminders(@CurrentUser() u: AuthUser): Promise<ReminderList> {
    return this.health.listReminders(u.userId);
  }

  @Post('reminders')
  createReminder(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createReminderRequestSchema)) b: CreateReminderRequest, @ReqMeta() meta: RequestMeta): Promise<Reminder> {
    return this.health.createReminder(u.userId, b, meta);
  }

  @Patch('reminders/:id')
  setActive(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateReminderRequestSchema)) b: UpdateReminderRequest): Promise<Reminder> {
    return this.health.setReminderActive(u.userId, id, b.active);
  }

  @Delete('reminders/:id')
  @HttpCode(204)
  async removeReminder(@CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.health.deleteReminder(u.userId, id, meta);
  }

  @Get('doses')
  doses(@CurrentUser() u: AuthUser): Promise<DoseList> {
    return this.health.listDoses(u.userId);
  }

  @Post('doses/:id/taken')
  @HttpCode(200)
  taken(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Dose> {
    return this.health.resolveDose(u.userId, id, 'taken');
  }

  @Post('doses/:id/skip')
  @HttpCode(200)
  skip(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<Dose> {
    return this.health.resolveDose(u.userId, id, 'skipped');
  }
}
