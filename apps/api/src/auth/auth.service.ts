import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type ChallengeResponse,
  ErrorCodes,
  type LoginRequest,
  type LoginResponse,
  type RegisterRequest,
  type Session,
  type TokenPair,
  type TwoFactorVerifyRequest,
  type VerifyOtpRequest,
} from '@caselind/contracts';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { pushTokens, refreshTokens, sessions, users, type UserRow } from '../db/schema.js';
import type { AuthUser } from '../security/auth.guard.js';
import { PasswordService } from '../security/password.service.js';
import { TokenService } from '../security/token.service.js';
import { TwoFactorService } from './identity/two-factor.service.js';
import { OtpSender } from './otp-sender.js';
import { OtpService } from './otp.service.js';

type Device = VerifyOtpRequest['device'];

const UNIQUE_VIOLATION = '23505';

function identifierKind(identifier: string): 'phone' | 'email' {
  return identifier.startsWith('+') ? 'phone' : 'email';
}

function channelOf(identifier: string): 'sms' | 'email' {
  return identifierKind(identifier) === 'phone' ? 'sms' : 'email';
}

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = (err as { cause?: unknown })?.cause ?? err;
  const pgErr = e as { code?: string; constraint?: string };
  return pgErr?.code === UNIQUE_VIOLATION && (!constraint || pgErr.constraint === constraint);
}

/** Builds a valid default handle from a display name, e.g. "Amani K." -> "amani_k_4821". */
export function handleFromDisplayName(displayName: string): string {
  const base = displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  return `${base.length >= 2 ? base : 'user'}_${randomInt(1000, 10000)}`;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly sender: OtpSender,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /**
   * Always answers with a challenge, whether or not the identifier is taken, so the endpoint
   * cannot be used to discover registered phone numbers or e-mails.
   */
  async register(req: RegisterRequest, meta: RequestMeta): Promise<ChallengeResponse> {
    const channel = channelOf(req.identifier);
    const existing = await this.findByIdentifier(req.identifier);

    if (existing && existing.status !== 'pending_verification') {
      return this.registerOnExistingAccount(existing, req.identifier, meta);
    }

    const passwordHash = await this.passwords.hash(req.password);
    let userId: string;
    if (existing) {
      // Unverified accounts have no proven owner: whoever proves the identifier via OTP owns it.
      await this.db
        .update(users)
        .set({ passwordHash, displayName: req.displayName, locale: req.locale, country: req.country ?? null })
        .where(eq(users.id, existing.id));
      userId = existing.id;
    } else {
      const created = await this.insertUser(req, passwordHash);
      if (!created) {
        // Lost a race against a concurrent registration of the same identifier.
        const winner = await this.findByIdentifier(req.identifier);
        if (!winner) throw new Error('user insert failed without a conflicting row');
        return this.registerOnExistingAccount(winner, req.identifier, meta);
      }
      userId = created;
    }

    await this.audit.record({ action: 'auth.register', subjectUserId: userId, meta, metadata: { channel } });
    return this.otp.create({ userId, purpose: 'signup', channel, destination: req.identifier, deliver: true });
  }

  async verifySignup(req: VerifyOtpRequest, meta: RequestMeta): Promise<TokenPair> {
    let userId: string;
    try {
      userId = await this.otp.verify(req.challengeId, req.code, 'signup');
    } catch (err) {
      await this.audit.record({ action: 'auth.otp_failed', meta, metadata: { challengeId: req.challengeId } });
      throw err;
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid code');

    const now = new Date();
    const verified = user.phone ? { phoneVerifiedAt: now } : { emailVerifiedAt: now };
    await this.db
      .update(users)
      .set({ status: 'active', ...verified })
      .where(and(eq(users.id, userId), eq(users.status, 'pending_verification')));

    await this.audit.record({ action: 'auth.otp_verified', subjectUserId: userId, meta });
    return this.createSession({ ...user, status: 'active' }, req.device, meta);
  }

  async login(req: LoginRequest, meta: RequestMeta): Promise<LoginResponse> {
    const user = await this.findByIdentifier(req.identifier);
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(423, ErrorCodes.accountLocked, 'Too many failed attempts, try again later', {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }

    const ok = await this.passwords.verify(user?.passwordHash ?? null, req.password);
    if (!user || !ok) {
      if (user) await this.recordFailedLogin(user, meta);
      throw new AppError(401, ErrorCodes.invalidCredentials, 'Incorrect identifier or password');
    }
    if (user.status === 'pending_verification') {
      throw new AppError(403, ErrorCodes.accountNotVerified, 'Verify your account before signing in');
    }
    if (user.status !== 'active' && !(await this.isSanctioned(user))) {
      throw new AppError(403, ErrorCodes.accountSuspended, 'This account is not active');
    }

    const cancelDeletion = this.assertDeletionNotDue(user);
    // Lot 1c: with 2FA the password only opens a challenge; counters, deletion cancellation and the
    // session wait for the second factor (POST /auth/2fa/verify).
    if (await this.twoFactor.isEnabled(user.id)) return this.twoFactor.createLoginChallenge(user.id, req.device);
    return this.completeLogin(user, cancelDeletion, req.device, meta);
  }

  /** Suspended by a sanction still in force: the session is then restricted (sanctions and appeal only, see AllowRestricted). */
  private async isSanctioned(user: UserRow): Promise<boolean> {
    if (user.status !== 'suspended') return false;
    const r = await this.db.execute(sql`SELECT 1 FROM user_sanctions s WHERE s.user_id = ${user.id}::uuid AND s.kind IN ('suspension_temp', 'ban') AND s.status IN ('active', 'appealed') AND (s.ends_at IS NULL OR s.ends_at > now())`);
    return r.rows.length > 0;
  }

  /** Second step of a login on an account with 2FA. */
  async verifyTwoFactor(req: TwoFactorVerifyRequest, meta: RequestMeta): Promise<TokenPair> {
    const { userId, device } = await this.twoFactor.completeLoginChallenge(req, meta);
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || (user.status !== 'active' && !(await this.isSanctioned(user)))) {
      throw new AppError(403, ErrorCodes.accountSuspended, 'This account is not active');
    }
    const cancelDeletion = this.assertDeletionNotDue(user);
    return this.completeLogin(user, cancelDeletion, device, meta, true);
  }

  /**
   * Pending deletion (decision, plan Phase 3): a successful login during the grace period
   * cancels the request. Once the grace period is over the account is refused even if the
   * maintenance purge has not run yet: the deletion is due and must not be undone silently.
   * Returns true when the pending deletion must be cancelled by this login.
   */
  private assertDeletionNotDue(user: UserRow): boolean {
    if (!user.deletionRequestedAt) return false;
    const dueAt = user.deletionRequestedAt.getTime() + this.env.ACCOUNT_DELETION_GRACE_DAYS * 86_400_000;
    if (dueAt <= Date.now()) {
      throw new AppError(403, ErrorCodes.accountSuspended, 'This account is being deleted');
    }
    return true;
  }

  private async completeLogin(
    user: UserRow,
    cancelDeletion: boolean,
    device: Device,
    meta: RequestMeta,
    twoFactor = false,
  ): Promise<TokenPair> {
    if (user.failedLoginCount > 0 || user.lockedUntil || cancelDeletion) {
      await this.db
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, ...(cancelDeletion ? { deletionRequestedAt: null } : {}) })
        .where(eq(users.id, user.id));
    }
    if (cancelDeletion) {
      await this.audit.record({ action: 'auth.deletion_cancelled', subjectUserId: user.id, meta });
    }
    // Seen = an earlier session of this account with the same platform and device name (user agent when unnamed).
    const seen = await this.db.execute(sql`SELECT 1 FROM sessions WHERE user_id = ${user.id}::uuid AND platform = ${device.platform} AND device_name IS NOT DISTINCT FROM ${device.name ?? null} AND (${device.name ?? null}::text IS NOT NULL OR user_agent IS NOT DISTINCT FROM ${meta.userAgent ?? null}) LIMIT 1`);
    const pair = await this.createSession(user, device, meta);
    await this.audit.record({
      action: 'auth.login',
      subjectUserId: user.id,
      sessionId: pair.sessionId,
      meta,
      ...(twoFactor ? { metadata: { twoFactor: true } } : {}),
    });
    // Security alert only for a device never seen on this account; fire-and-forget, never fails the login.
    if (seen.rows.length === 0) {
      const kind = { ios: 'un iPhone', android: 'un téléphone Android', web: 'un navigateur web', other: 'un nouvel appareil' }[device.platform];
      void this.notifications
        .notify({
          userId: user.id,
          category: 'security',
          title: 'Nouvelle connexion',
          body: `Connexion depuis ${kind}${device.name ? ` (${device.name})` : ''}. Si ce n'est pas vous, changez votre mot de passe.`,
          urgent: true,
        })
        .catch(() => undefined);
    }
    return pair;
  }

  /** Single-use rotation. Replaying a consumed token revokes the whole session (likely theft). */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    const invalid = () => new AppError(401, ErrorCodes.refreshTokenInvalid, 'Refresh token is invalid or expired');
    const hash = TokenService.hashRefresh(refreshToken);
    const [found] = await this.db
      .select({ token: refreshTokens, session: sessions, user: users })
      .from(refreshTokens)
      .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);
    if (!found) throw invalid();

    const [claimed] = await this.db
      .update(refreshTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(refreshTokens.id, found.token.id), isNull(refreshTokens.usedAt)))
      .returning({ id: refreshTokens.id });
    if (!claimed) {
      if (!found.session.revokedAt) {
        await this.revoke(found.session.id, 'refresh_token_reuse');
        this.realtime.disconnectUser(found.user.id);
        await this.audit.record({
          action: 'auth.refresh_token_reuse',
          subjectUserId: found.user.id,
          sessionId: found.session.id,
          meta,
        });
      }
      throw invalid();
    }

    const now = new Date();
    if (
      found.session.revokedAt ||
      found.session.expiresAt <= now ||
      found.token.expiresAt <= now ||
      (found.user.status !== 'active' && !(await this.isSanctioned(found.user)))
    ) {
      throw invalid();
    }
    return this.issueTokens(found.user, found.session.id, meta);
  }

  async logout(auth: AuthUser, meta: RequestMeta): Promise<void> {
    await this.revoke(auth.sessionId, 'logout');
    await this.audit.record({ action: 'auth.logout', actorUserId: auth.userId, sessionId: auth.sessionId, meta });
  }

  async listSessions(auth: AuthUser): Promise<Session[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, auth.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastUsedAt));
    return rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      platform: s.platform,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === auth.sessionId,
    }));
  }

  async revokeSession(auth: AuthUser, sessionId: string, meta: RequestMeta): Promise<void> {
    const [row] = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: 'revoked_by_user' })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    // Same answer for "not yours" and "does not exist": no cross-user probing.
    if (!row) throw AppError.notFound('Session not found');
    await this.db.delete(pushTokens).where(eq(pushTokens.sessionId, sessionId));
    this.realtime.disconnectSession(sessionId);
    await this.audit.record({
      action: 'auth.session_revoked',
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      meta,
      metadata: { revokedSessionId: sessionId },
    });
  }

  /** Always answers 202 with a challenge; nothing is sent for unknown or inactive identifiers. */
  async forgotPassword(identifier: string, meta: RequestMeta): Promise<ChallengeResponse> {
    const user = await this.findByIdentifier(identifier);
    const active = user?.status === 'active';
    if (active) {
      await this.audit.record({ action: 'auth.password_reset_requested', subjectUserId: user.id, meta });
    }
    return this.otp.create({
      userId: active ? user.id : null,
      purpose: 'password_reset',
      channel: channelOf(identifier),
      destination: identifier,
      deliver: active,
    });
  }

  /** Two-factor authentication deliberately survives a reset: the password step alone never opens a session. */
  async resetPassword(challengeId: string, code: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const userId = await this.otp.verify(challengeId, code, 'password_reset');
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokeReason: 'password_reset' })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    });
    this.realtime.disconnectUser(userId);
    await this.audit.record({ action: 'auth.password_reset', subjectUserId: userId, meta });
  }

  private async registerOnExistingAccount(
    existing: UserRow,
    identifier: string,
    meta: RequestMeta,
  ): Promise<ChallengeResponse> {
    const channel = channelOf(identifier);
    await this.sender.send({ kind: 'already_registered', channel, destination: identifier });
    await this.audit.record({ action: 'auth.register_existing_identifier', subjectUserId: existing.id, meta });
    return this.otp.create({ userId: null, purpose: 'signup', channel, destination: identifier, deliver: false });
  }

  /** Returns the new user id, or null if the identifier was taken concurrently. */
  private async insertUser(req: RegisterRequest, passwordHash: string): Promise<string | null> {
    const kind = identifierKind(req.identifier);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [row] = await this.db
          .insert(users)
          .values({
            email: kind === 'email' ? req.identifier : null,
            phone: kind === 'phone' ? req.identifier : null,
            passwordHash,
            displayName: req.displayName,
            handle: handleFromDisplayName(req.displayName),
            locale: req.locale,
            country: req.country ?? null,
          })
          .returning({ id: users.id });
        return row!.id;
      } catch (err) {
        if (isUniqueViolation(err, 'users_handle_key')) continue;
        if (isUniqueViolation(err)) return null;
        throw err;
      }
    }
    throw new Error('could not allocate a unique handle');
  }

  private findByIdentifier(identifier: string): Promise<UserRow | undefined> {
    const column = identifierKind(identifier) === 'phone' ? users.phone : users.email;
    return this.db
      .select()
      .from(users)
      .where(eq(column, identifier))
      .limit(1)
      .then((r) => r[0]);
  }

  private async recordFailedLogin(user: UserRow, meta: RequestMeta): Promise<void> {
    const [updated] = await this.db
      .update(users)
      .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
      .where(eq(users.id, user.id))
      .returning({ count: users.failedLoginCount });
    await this.audit.record({ action: 'auth.login_failed', subjectUserId: user.id, meta });
    if (updated && updated.count >= this.env.LOGIN_MAX_FAILURES) {
      const lockedUntil = new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60_000);
      await this.db.update(users).set({ lockedUntil, failedLoginCount: 0 }).where(eq(users.id, user.id));
      await this.audit.record({
        action: 'auth.account_locked',
        subjectUserId: user.id,
        meta,
        metadata: { lockedUntil: lockedUntil.toISOString() },
      });
    }
  }

  /** Opens a session and issues the first token pair (login, sign-up, 2FA and QR flows). */
  async createSession(user: UserRow, device: Device, meta: RequestMeta): Promise<TokenPair> {
    const [session] = await this.db
      .insert(sessions)
      .values({
        userId: user.id,
        deviceName: device.name ?? null,
        platform: device.platform,
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      })
      .returning({ id: sessions.id });
    return this.issueTokens(user, session!.id, meta);
  }

  private async issueTokens(user: UserRow, sessionId: string, meta: RequestMeta): Promise<TokenPair> {
    const refresh = this.tokens.newRefreshToken();
    await this.db.insert(refreshTokens).values({ sessionId, tokenHash: refresh.hash, expiresAt: refresh.expiresAt });
    // Daily active-user counter (one row per user and day, kept beyond the 7 days of refresh tokens) for the admin analytics.
    await this.db.execute(sql`INSERT INTO user_active_days (user_id, day) VALUES (${user.id}::uuid, (now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING`);
    // Sliding expiry: an active session stays alive, an idle one ends after the refresh TTL.
    await this.db
      .update(sessions)
      .set({ lastUsedAt: new Date(), expiresAt: refresh.expiresAt, ip: meta.ip ?? undefined })
      .where(eq(sessions.id, sessionId));
    const access = await this.tokens.signAccess({ sub: user.id, sid: sessionId, roles: user.roles });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
      sessionId,
    };
  }

  private async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    await this.db.delete(pushTokens).where(eq(pushTokens.sessionId, sessionId));
    this.realtime.disconnectSession(sessionId);
  }
}
