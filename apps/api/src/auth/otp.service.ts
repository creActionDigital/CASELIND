import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type ChallengeResponse, ErrorCodes } from '@caselind/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env.js';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { otpChallenges, type OtpChallengeRow } from '../db/schema.js';
import { OtpSender } from './otp-sender.js';

type Purpose = OtpChallengeRow['purpose'];
type Channel = OtpChallengeRow['channel'];

const MAX_RESENDS = 3;

export interface CreateChallengeInput {
  /** null creates a decoy that looks real to the caller but can never be verified. */
  userId: string | null;
  purpose: Purpose;
  channel: Channel;
  destination: string;
  /** false for decoys where nothing must be sent (e.g. password reset of an unknown identifier). */
  deliver: boolean;
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly sender: OtpSender,
  ) {}

  async create(input: CreateChallengeInput): Promise<ChallengeResponse> {
    const id = randomUUID();
    const code = OtpService.generateCode();
    const expiresAt = new Date(Date.now() + this.env.OTP_TTL_SECONDS * 1000);

    if (input.userId) {
      // Only the latest challenge for a user and purpose stays usable.
      await this.db
        .update(otpChallenges)
        .set({ expiresAt: new Date() })
        .where(
          and(
            eq(otpChallenges.userId, input.userId),
            eq(otpChallenges.purpose, input.purpose),
            isNull(otpChallenges.consumedAt),
          ),
        );
    }
    await this.db.insert(otpChallenges).values({
      id,
      userId: input.userId,
      purpose: input.purpose,
      channel: input.channel,
      destination: input.destination,
      codeHash: this.hashCode(id, code),
      expiresAt,
    });
    if (input.userId && input.deliver) {
      await this.sender.send({
        kind: 'code',
        channel: input.channel,
        destination: input.destination,
        purpose: input.purpose,
        code,
      });
    }
    return { challengeId: id, channel: input.channel, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Consumes the challenge if the code matches. Returns the owning user id.
   * Every attempt is counted atomically before comparison, so parallel guesses cannot exceed the limit.
   */
  async verify(challengeId: string, code: string, purpose: Purpose): Promise<string> {
    const [row] = await this.db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(
        and(eq(otpChallenges.id, challengeId), eq(otpChallenges.purpose, purpose), isNull(otpChallenges.consumedAt)),
      )
      .returning();
    if (!row) throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid or already used code');
    if (row.expiresAt <= new Date() || row.attempts > row.maxAttempts) {
      throw new AppError(410, ErrorCodes.otpExpired, 'This code has expired, request a new one');
    }

    const matches = timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(this.hashCode(row.id, code)));
    if (!matches || !row.userId) {
      throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid code', {
        attemptsRemaining: Math.max(0, row.maxAttempts - row.attempts),
      });
    }

    const [consumed] = await this.db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpChallenges.id, row.id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    if (!consumed) throw new AppError(400, ErrorCodes.otpInvalid, 'Invalid or already used code');
    return row.userId;
  }

  async resend(challengeId: string): Promise<ChallengeResponse> {
    const [row] = await this.db.select().from(otpChallenges).where(eq(otpChallenges.id, challengeId)).limit(1);
    if (!row || row.consumedAt || row.expiresAt <= new Date() || row.resendCount >= MAX_RESENDS) {
      throw new AppError(410, ErrorCodes.otpExpired, 'This challenge can no longer be resent, start again');
    }
    const elapsed = (Date.now() - row.lastSentAt.getTime()) / 1000;
    if (elapsed < this.env.OTP_RESEND_COOLDOWN_SECONDS) {
      throw new AppError(429, ErrorCodes.otpResendTooSoon, 'Please wait before requesting a new code', {
        retryAfterSeconds: Math.ceil(this.env.OTP_RESEND_COOLDOWN_SECONDS - elapsed),
      });
    }

    const code = OtpService.generateCode();
    const expiresAt = new Date(Date.now() + this.env.OTP_TTL_SECONDS * 1000);
    const [updated] = await this.db
      .update(otpChallenges)
      .set({
        codeHash: this.hashCode(row.id, code),
        attempts: 0,
        resendCount: sql`${otpChallenges.resendCount} + 1`,
        lastSentAt: new Date(),
        expiresAt,
      })
      .where(and(eq(otpChallenges.id, row.id), eq(otpChallenges.resendCount, row.resendCount)))
      .returning({ id: otpChallenges.id });
    if (!updated) {
      throw new AppError(429, ErrorCodes.otpResendTooSoon, 'Please wait before requesting a new code');
    }
    if (row.userId) {
      await this.sender.send({
        kind: 'code',
        channel: row.channel,
        destination: row.destination,
        purpose: row.purpose,
        code,
      });
    }
    return { challengeId: row.id, channel: row.channel, expiresAt: expiresAt.toISOString() };
  }

  static generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  /** Keyed hash: a leaked database alone is not enough to brute-force 6-digit codes offline. */
  private hashCode(challengeId: string, code: string): string {
    return createHmac('sha256', this.env.OTP_PEPPER).update(`${challengeId}:${code}`).digest('hex');
  }
}
