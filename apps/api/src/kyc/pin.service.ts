import { Inject, Injectable } from '@nestjs/common';
import { ErrorCodes, type SetPaymentPinRequest } from '@caselind/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { paymentPins, users } from '../db/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PasswordService } from '../security/password.service.js';
import { type PinCheck, PinVerifier } from '../wallet/pin.port.js';

/** Payment PIN: Argon2id hash, brute-force counter with a temporary lock. Implements the wallet's PinVerifier. */
@Injectable()
export class PinService extends PinVerifier {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async has(userId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: paymentPins.userId }).from(paymentPins).where(eq(paymentPins.userId, userId)).limit(1);
    return row !== undefined;
  }

  /** Sets or changes the PIN. The account password is required; a wrong one is a plain 401. */
  async set(userId: string, sessionId: string | null, body: SetPaymentPinRequest, meta: RequestMeta): Promise<void> {
    const [user] = await this.db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw AppError.unauthenticated();
    if (!(await this.passwords.verify(user.passwordHash, body.password))) {
      throw new AppError(401, ErrorCodes.invalidCredentials, 'Incorrect password');
    }
    const pinHash = await this.passwords.hash(body.pin);
    const changed = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ existed: boolean }>(sql`
        INSERT INTO payment_pins (user_id, pin_hash) VALUES (${userId}, ${pinHash})
        ON CONFLICT (user_id) DO UPDATE
          SET pin_hash = EXCLUDED.pin_hash, failed_count = 0, locked_until = NULL, set_at = now(), updated_at = now()
        RETURNING (xmax <> 0) AS existed`);
      const existed = res.rows[0]?.existed === true;
      // Never the PIN itself.
      await this.audit.record({ action: 'wallet.pin_set', actorUserId: userId, sessionId, meta, metadata: { changed: existed } }, tx);
      return existed;
    });
    await this.notifications.notify({
      userId,
      category: 'security',
      title: changed ? 'Code PIN de paiement modifié' : 'Code PIN de paiement défini',
      body: changed
        ? 'Votre code PIN de paiement vient d’être modifié. Si ce n’est pas vous, changez votre mot de passe.'
        : 'Un code PIN de paiement est maintenant actif sur votre compte.',
      urgent: true,
    });
  }

  /**
   * Checks a PIN. The counter lives in the database and the row is locked for the whole check, so
   * parallel guesses cannot beat the limit. After PAYMENT_PIN_MAX_ATTEMPTS wrong PINs the account is
   * locked for PAYMENT_PIN_LOCK_MINUTES (even the right PIN is refused meanwhile); success resets it.
   */
  async verify(userId: string, pin: string): Promise<PinCheck> {
    return this.db.transaction(async (tx): Promise<PinCheck> => {
      const [row] = await tx.select().from(paymentPins).where(eq(paymentPins.userId, userId)).for('update').limit(1);
      if (!row) return { status: 'not_set' };
      const now = new Date();
      if (row.lockedUntil && row.lockedUntil > now) return { status: 'locked', lockedUntil: row.lockedUntil };
      if (await this.passwords.verify(row.pinHash, pin)) {
        if (row.failedCount > 0 || row.lockedUntil) {
          await tx.update(paymentPins).set({ failedCount: 0, lockedUntil: null, updatedAt: now }).where(eq(paymentPins.userId, userId));
        }
        return { status: 'ok' };
      }
      const failed = row.failedCount + 1;
      const lock = failed >= this.env.PAYMENT_PIN_MAX_ATTEMPTS;
      await tx
        .update(paymentPins)
        .set({
          failedCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(now.getTime() + this.env.PAYMENT_PIN_LOCK_MINUTES * 60_000) : null,
          updatedAt: now,
        })
        .where(eq(paymentPins.userId, userId));
      await this.audit.record({ action: lock ? 'wallet.pin_locked' : 'wallet.pin_failed', actorUserId: userId, metadata: { failedCount: failed } }, tx);
      return { status: 'invalid', attemptsRemaining: Math.max(this.env.PAYMENT_PIN_MAX_ATTEMPTS - failed, 0) };
    });
  }
}
