import { Inject, Injectable } from '@nestjs/common';
import {
  type ChallengeResponse,
  ErrorCodes,
  type IdentifierChangeRequest,
  type IdentifierChangeVerify,
} from '@caselind/contracts';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import type { RequestMeta } from '../../common/request-meta.js';
import { DB, type Db } from '../../db/db.module.js';
import { otpChallenges, pushTokens, sessions, users } from '../../db/schema.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { RealtimeService } from '../../realtime/realtime.service.js';
import type { AuthUser } from '../../security/auth.guard.js';
import { PasswordService } from '../../security/password.service.js';
import { OtpSender } from '../otp-sender.js';
import { OtpService } from '../otp.service.js';

const isPhone = (identifier: string) => identifier.startsWith('+');

/**
 * Changes the phone number or e-mail of the signed-in account: password, then a one-time code sent to
 * the NEW identifier. Availability is only checked at confirmation (under lock), so the request step
 * answers the same way whether or not the identifier is taken.
 */
@Injectable()
export class IdentifierChangeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly passwords: PasswordService,
    private readonly otp: OtpService,
    private readonly sender: OtpSender,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  async request(auth: AuthUser, req: IdentifierChangeRequest, meta: RequestMeta): Promise<ChallengeResponse> {
    const [user] = await this.db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
    if (!user) throw AppError.unauthenticated();
    if (!(await this.passwords.verify(user.passwordHash, req.password))) {
      throw new AppError(401, ErrorCodes.invalidCredentials, 'Incorrect password');
    }
    if (req.newIdentifier === user.email || req.newIdentifier === user.phone) {
      throw new AppError(400, ErrorCodes.validationFailed, 'The new identifier must differ from the current one');
    }
    const channel = isPhone(req.newIdentifier) ? 'sms' : 'email';
    await this.audit.record({
      action: 'user.identifier_change_requested',
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      meta,
      metadata: { channel },
    });
    return this.otp.create({
      userId: auth.userId,
      purpose: 'identifier_change',
      channel,
      destination: req.newIdentifier,
      deliver: true,
    });
  }

  async verify(auth: AuthUser, req: IdentifierChangeVerify, meta: RequestMeta): Promise<void> {
    // A challenge of another user is refused before it can be consumed.
    const [challenge] = await this.db
      .select({ userId: otpChallenges.userId, destination: otpChallenges.destination, purpose: otpChallenges.purpose })
      .from(otpChallenges)
      .where(eq(otpChallenges.id, req.challengeId))
      .limit(1);
    if (!challenge || challenge.userId !== auth.userId || challenge.purpose !== 'identifier_change') {
      throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid or already used code');
    }
    await this.otp.verify(req.challengeId, req.code, 'identifier_change');

    const identifier = challenge.destination;
    const phone = isPhone(identifier);
    const now = new Date();
    let oldEmail = null as string | null;
    let revoked = [] as string[];
    try {
      await this.db.transaction(async (tx) => {
        // Serialises concurrent claims of the same identifier; the unique constraints are the last line of defence.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`identifier:${identifier}`}))`);
        const locked = await tx.execute<{ id: string }>(sql`SELECT id FROM users WHERE id = ${auth.userId} FOR UPDATE`);
        if (locked.rows.length === 0) throw AppError.unauthenticated();
        const [current] = await tx.select().from(users).where(eq(users.id, auth.userId)).limit(1);
        const [holder] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(phone ? users.phone : users.email, identifier), ne(users.id, auth.userId)))
          .limit(1);
        if (holder) throw AppError.conflict('This identifier is already in use');
        if (!phone) oldEmail = current?.email ?? null;
        await tx
          .update(users)
          .set(phone ? { phone: identifier, phoneVerifiedAt: now } : { email: identifier, emailVerifiedAt: now })
          .where(eq(users.id, auth.userId));
        const rows = await tx
          .update(sessions)
          .set({ revokedAt: now, revokeReason: 'identifier_changed' })
          .where(and(eq(sessions.userId, auth.userId), ne(sessions.id, auth.sessionId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        revoked = rows.map((r) => r.id);
        for (const id of revoked) await tx.delete(pushTokens).where(eq(pushTokens.sessionId, id));
        await this.audit.record(
          {
            action: 'user.identifier_changed',
            actorUserId: auth.userId,
            sessionId: auth.sessionId,
            meta,
            metadata: { channel: phone ? 'sms' : 'email', revokedSessions: revoked.length },
          },
          tx,
        );
      });
    } catch (err) {
      if ((err as { cause?: { code?: string } })?.cause?.code === '23505' || (err as { code?: string })?.code === '23505') {
        throw AppError.conflict('This identifier is already in use');
      }
      throw err;
    }

    for (const id of revoked) this.realtime.disconnectSession(id);
    if (oldEmail && oldEmail !== identifier) {
      await this.sender.send({ kind: 'identifier_changed', channel: 'email', destination: oldEmail }).catch(() => undefined);
    }
    await this.notifications
      .notify({
        userId: auth.userId,
        category: 'security',
        title: 'Identifiant de connexion modifié',
        body: 'Vos autres appareils ont été déconnectés.',
        urgent: true,
      })
      .catch(() => undefined);
  }
}
