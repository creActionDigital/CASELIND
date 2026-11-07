import { Injectable } from '@nestjs/common';

export type KycTier = 0 | 1 | 2;

/** Per-tier limits in minor units of the given currency. */
export interface KycLimits {
  tier: KycTier;
  maxBalanceMinor: number;
  maxSingleTransferMinor: number;
  maxDailyOutgoingMinor: number;
}

/**
 * KYC tiers and their limits (lot 6B), read by the ledger before any outgoing transfer.
 * The stub treats everyone as tier 0 with the most conservative limits.
 */
@Injectable()
export class KycPort {
  async limitsFor(_userId: string, currency: string): Promise<KycLimits> {
    const unit = currency === 'CDF' ? 2800 : 1; // rough CDF per USD, sandbox only
    return { tier: 0, maxBalanceMinor: 100_00 * unit, maxSingleTransferMinor: 50_00 * unit, maxDailyOutgoingMinor: 100_00 * unit };
  }
}
