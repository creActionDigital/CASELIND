import { randomUUID } from 'node:crypto';
import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AccountController } from './account/account.controller.js';
import { AccountService } from './account/account.service.js';
import { AdminController } from './admin/admin.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { ConsoleOtpSender, OtpSender } from './auth/otp-sender.js';
import { OtpService } from './auth/otp.service.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ENV, type Env } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { FlagGuard } from './flags/flag.guard.js';
import { AdminFlagsController, ConfigController } from './flags/flags.controller.js';
import { FlagsService } from './flags/flags.service.js';
import { HealthController } from './health/health.controller.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { OpenApiController } from './openapi/openapi.controller.js';
import { PrivacyController } from './privacy/privacy.controller.js';
import { PrivacyService } from './privacy/privacy.service.js';
import { AuthGuard } from './security/auth.guard.js';
import { PasswordService } from './security/password.service.js';
import { TokenService } from './security/token.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

export interface AppModuleOptions {
  env: Env;
  /** Overrides the OTP delivery adapter (tests capture codes this way). */
  otpSender?: OtpSender;
  /** Test-only: extra controllers mounted behind the same global guards (e.g. a @RequireFlag probe). */
  extraControllers?: Type[];
}

@Module({})
export class AppModule {
  static forRoot({ env, otpSender, extraControllers = [] }: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        { module: class EnvModule {}, global: true, providers: [{ provide: ENV, useValue: env }], exports: [ENV] },
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            // Never log credentials. Bodies are not logged by pino-http.
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          },
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
            {
              // Stricter budget for credential and OTP endpoints (brute force, SMS pumping).
              name: 'auth',
              ttl: 60_000,
              limit: env.AUTH_RATE_LIMIT_PER_MINUTE,
              skipIf: (ctx) => ctx.getClass() !== AuthController,
            },
          ],
        }),
        DbModule,
        // Without ScheduleModule the @Interval jobs (MaintenanceService) are never started.
        ...(env.MAINTENANCE_ENABLED ? [ScheduleModule.forRoot()] : []),
      ],
      controllers: [
        HealthController,
        OpenApiController,
        AuthController,
        UsersController,
        AdminController,
        ConfigController,
        AdminFlagsController,
        PrivacyController,
        AccountController,
        ...extraControllers,
      ],
      providers: [
        PasswordService,
        TokenService,
        AuditService,
        OtpService,
        AuthService,
        UsersService,
        FlagsService,
        MaintenanceService,
        PrivacyService,
        AccountService,
        { provide: OtpSender, useValue: otpSender ?? new ConsoleOtpSender() },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        // Must stay after AuthGuard: global guards run in registration order and it needs req.auth.
        { provide: APP_GUARD, useClass: FlagGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
