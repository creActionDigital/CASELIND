import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  type TotpDisableRequest,
  type TotpEnableRequest,
  type TotpEnableResponse,
  type TotpSetupResponse,
  type TwoFactorRequired,
  type TwoFactorVerifyRequest,
} from '@caselind/contracts';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import type { RequestMeta } from '../../common/request-meta.js';
import { ENV, type Env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.module.js';
import { twoFactorChallenges, userBackupCodes, userTotp, users } from '../../db/schema.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import type { AuthUser } from '../../security/auth.guard.js';
import { PasswordService } from '../../security/password.service.js';
import { TotpCrypto } from './totp-crypto.js';
import { generateSecret, otpauthUri, verifyTotp } from './totp.js';

const CHALLENGE_TTL_MS = 5 * 60_000;
const BACKUP_CODE_COUNT = 10;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

type Device = TwoFactorVerifyRequest['device'];
type SecondFactor = { code?: string | undefined; backupCode?: string | undefined };

/** Generates `xxxxx-xxxxx` (50 bits of entropy). */
function newBackupCode(): string {
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => B32[b % 32]!).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

const normalizeBackupCode = (code: string) => code.toLowerCase().replace(/[^a-z2-7]/g, '');

/** TOTP enrolment, second factor at login and backup codes. Secrets and codes are never logged or audited. */
@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly crypto: TotpCrypto,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async isEnabled(userId: string): Promise<boolean> {
    return (await this.exportStatus(userId)).twoFactorEnabled;
  }

  /** For the account export: status and date only. */
  async exportStatus(userId: string): Promise<{ twoFactorEnabled: boolean; twoFactorEnabledAt: string | null }> {
    const [row] = await this.db
      .select({ enabledAt: userTotp.enabledAt })
      .from(userTotp)
      .where(eq(userTotp.userId, userId))
      .limit(1);
    return { twoFactorEnabled: Boolean(row?.enabledAt), twoFactorEnabledAt: row?.enabledAt?.toISOString() ?? null };
  }

  /** Starts (or restarts) enrolment. The secret is returned once and stored encrypted, inactive until `enable`. */
  async setup(auth: AuthUser): Promise<TotpSetupResponse> {
    if (await this.isEnabled(auth.userId)) throw AppError.conflict('Two-factor authentication is already enabled');
    const [user] = await this.db
      .select({ email: users.email, phone: users.phone, handle: users.handle })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    if (!user) throw AppError.unauthenticated();
    const secret = generateSecret();
    const secretEnc = this.crypto.encrypt(auth.userId, secret);
    await this.db
      .insert(userTotp)
      .values({ userId: auth.userId, secretEnc })
      .onConflictDoUpdate({
        target: userTotp.userId,
        set: { secretEnc, lastUsedStep: 0, createdAt: new Date() },
        setWhere: isNull(userTotp.enabledAt),
      });
    return { secret, otpauthUri: otpauthUri(secret, user.email ?? user.phone ?? String(user.handle)) };
  }

  async enable(auth: AuthUser, req: TotpEnableRequest, meta: RequestMeta): Promise<TotpEnableResponse> {
    await this.assertPassword(auth.userId, req.password);
    if (!(await this.consumeTotp(auth.userId, req.code, false))) {
      throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid code');
    }
    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
    await this.db.transaction(async (tx) => {
      const [enabled] = await tx
        .update(userTotp)
        .set({ enabledAt: new Date() })
        .where(and(eq(userTotp.userId, auth.userId), isNull(userTotp.enabledAt)))
        .returning({ userId: userTotp.userId });
      if (!enabled) throw AppError.conflict('Two-factor authentication is already enabled');
      await tx.delete(userBackupCodes).where(eq(userBackupCodes.userId, auth.userId));
      await tx
        .insert(userBackupCodes)
        .values(backupCodes.map((c) => ({ userId: auth.userId, codeHash: this.hashBackup(auth.userId, c) })));
    });
    await this.audit.record({ action: 'auth.2fa_enabled', actorUserId: auth.userId, sessionId: auth.sessionId, meta });
    await this.alert(auth.userId, 'Authentification à deux facteurs activée', 'Un code sera demandé à chaque connexion.');
    return { backupCodes };
  }

  async disable(auth: AuthUser, req: TotpDisableRequest, meta: RequestMeta): Promise<void> {
    await this.assertPassword(auth.userId, req.password);
    if (!(await this.isEnabled(auth.userId))) throw AppError.conflict('Two-factor authentication is not enabled');
    if (!(await this.checkSecondFactor(auth.userId, req, meta))) {
      throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid code');
    }
    await this.wipe(auth.userId);
    await this.audit.record({ action: 'auth.2fa_disabled', actorUserId: auth.userId, sessionId: auth.sessionId, meta });
    await this.alert(auth.userId, 'Authentification à deux facteurs désactivée', 'La vérification en deux étapes est inactive.');
  }

  /** Removes the secret, backup codes and pending login challenges of a user. */
  async wipe(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(userTotp).where(eq(userTotp.userId, userId));
      await tx.delete(userBackupCodes).where(eq(userBackupCodes.userId, userId));
      await tx.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, userId));
    });
  }

  /** Called after a correct password for an account with 2FA. */
  async createLoginChallenge(userId: string, device: Device): Promise<TwoFactorRequired> {
    const [row] = await this.db
      .insert(twoFactorChallenges)
      .values({
        userId,
        deviceName: device.name ?? null,
        platform: device.platform,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      })
      .returning({ id: twoFactorChallenges.id });
    return { twoFactorRequired: true, challengeId: row!.id };
  }

  /**
   * Checks the second factor of a login challenge and consumes it. Every attempt is counted atomically
   * before the comparison; after `maxAttempts` the challenge is dead (410), whatever the code.
   */
  async completeLoginChallenge(
    req: TwoFactorVerifyRequest,
    meta: RequestMeta,
  ): Promise<{ userId: string; device: Device }> {
    const [row] = await this.db
      .update(twoFactorChallenges)
      .set({ attempts: sql`${twoFactorChallenges.attempts} + 1` })
      .where(and(eq(twoFactorChallenges.id, req.challengeId), isNull(twoFactorChallenges.consumedAt)))
      .returning();
    if (!row) throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid or already used challenge');
    if (row.expiresAt <= new Date() || row.attempts > row.maxAttempts) {
      throw new AppError(410, ErrorCodes.otpExpired, 'This challenge has expired, sign in again');
    }
    if (!(await this.checkSecondFactor(row.userId, req, meta))) {
      await this.audit.record({ action: 'auth.2fa_failed', subjectUserId: row.userId, meta });
      throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid code', {
        attemptsRemaining: Math.max(0, row.maxAttempts - row.attempts),
      });
    }
    const [consumed] = await this.db
      .update(twoFactorChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(twoFactorChallenges.id, row.id), isNull(twoFactorChallenges.consumedAt)))
      .returning({ id: twoFactorChallenges.id });
    if (!consumed) throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid or already used challenge');
    return {
      userId: row.userId,
      device: { platform: row.platform as Device['platform'], ...(row.deviceName ? { name: row.deviceName } : {}) },
    };
  }

  async purgeExpiredChallenges(cutoff: Date): Promise<number> {
    const res = await this.db.delete(twoFactorChallenges).where(lt(twoFactorChallenges.expiresAt, cutoff));
    return res.rowCount ?? 0;
  }

  /** TOTP code or backup code; a backup code use is audited and notified. */
  private async checkSecondFactor(userId: string, factor: SecondFactor, meta: RequestMeta): Promise<boolean> {
    if (factor.code !== undefined) return this.consumeTotp(userId, factor.code, true);
    if (factor.backupCode === undefined) return false;
    const [used] = await this.db
      .update(userBackupCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(userBackupCodes.userId, userId),
          eq(userBackupCodes.codeHash, this.hashBackup(userId, factor.backupCode)),
          isNull(userBackupCodes.usedAt),
        ),
      )
      .returning({ id: userBackupCodes.id });
    if (!used) return false;
    const [counted] = await this.db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(userBackupCodes)
      .where(and(eq(userBackupCodes.userId, userId), isNull(userBackupCodes.usedAt)));
    const remaining = counted?.remaining ?? 0;
    await this.audit.record({ action: 'auth.2fa_backup_used', subjectUserId: userId, meta, metadata: { remaining } });
    await this.alert(userId, 'Code de secours utilisé', `Il vous reste ${remaining} code(s) de secours.`);
    return true;
  }

  /**
   * Validates a TOTP code (±1 step) and claims its time step: a step is accepted once, so a code that
   * was already used (or an older one) is refused. `enabled` selects the enrolment (false) or login (true) phase.
   */
  private async consumeTotp(userId: string, code: string, enabled: boolean): Promise<boolean> {
    const [row] = await this.db.select().from(userTotp).where(eq(userTotp.userId, userId)).limit(1);
    if (!row || Boolean(row.enabledAt) !== enabled) return false;
    let secret: string;
    try {
      secret = this.crypto.decrypt(userId, row.secretEnc);
    } catch {
      return false;
    }
    const step = verifyTotp(secret, code, Date.now());
    if (step === null || step <= row.lastUsedStep) return false;
    const [claimed] = await this.db
      .update(userTotp)
      .set({ lastUsedStep: step })
      .where(and(eq(userTotp.userId, userId), sql`${userTotp.lastUsedStep} < ${step}`))
      .returning({ userId: userTotp.userId });
    return Boolean(claimed);
  }

  private async assertPassword(userId: string, password: string): Promise<void> {
    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw AppError.unauthenticated();
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new AppError(401, ErrorCodes.invalidCredentials, 'Incorrect password');
    }
  }

  private hashBackup(userId: string, code: string): string {
    return createHmac('sha256', this.env.OTP_PEPPER).update(`backup:${userId}:${normalizeBackupCode(code)}`).digest('hex');
  }

  private async alert(userId: string, title: string, body: string): Promise<void> {
    await this.notifications.notify({ userId, category: 'security', title, body, urgent: true }).catch(() => undefined);
  }
}
