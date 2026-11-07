import { Injectable } from '@nestjs/common';
import { ErrorCodes } from '@caselind/contracts';
import { AppError } from '../common/app-error.js';

export type PinCheck =
  | { status: 'ok' }
  | { status: 'not_set' }
  | { status: 'invalid'; attemptsRemaining: number }
  | { status: 'locked'; lockedUntil: Date };

/** The refusal for a failed PIN check (same statuses and `details` on every route that checks a PIN); null when it passed. */
export function pinRefusal(check: PinCheck): AppError | null {
  switch (check.status) {
    case 'ok':
      return null;
    case 'not_set':
      return AppError.conflict('Set a transaction PIN first', { reason: 'pin_not_set' });
    case 'locked':
      return new AppError(423, ErrorCodes.accountLocked, 'PIN locked, try again later', {
        reason: 'pin_locked',
        lockedUntil: check.lockedUntil.toISOString(),
      });
    case 'invalid':
      return new AppError(403, ErrorCodes.forbidden, 'Incorrect PIN', { reason: 'pin_invalid', attemptsRemaining: check.attemptsRemaining });
  }
}

/**
 * Transaction PIN check (lot 6B). The wallet calls it before any user-initiated transfer.
 * The stub reports that no PIN is set, so transfers are refused until 6B provides the real verifier.
 */
@Injectable()
export abstract class PinVerifier {
  abstract verify(userId: string, pin: string): Promise<PinCheck>;
}

@Injectable()
export class StubPinVerifier extends PinVerifier {
  async verify(_userId: string, _pin: string): Promise<PinCheck> {
    return { status: 'not_set' };
  }
}
