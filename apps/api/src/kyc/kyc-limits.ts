import type { KycLimits, KycTier } from '../wallet/kyc.port.js';
import type { KycLimitsOverride } from '../config/env.js';

/** Rough CDF per USD, sandbox only (same scale as the ledger stub). */
const CDF_PER_USD = 2800;

/** Prudent defaults in USD minor units (cents): tier 0 / 1 / 2. */
const USD_DEFAULTS: Record<KycTier, Omit<KycLimits, 'tier'>> = {
  0: { maxBalanceMinor: 100_00, maxSingleTransferMinor: 50_00, maxDailyOutgoingMinor: 100_00 },
  1: { maxBalanceMinor: 1_000_00, maxSingleTransferMinor: 500_00, maxDailyOutgoingMinor: 1_000_00 },
  2: { maxBalanceMinor: 5_000_00, maxSingleTransferMinor: 2_000_00, maxDailyOutgoingMinor: 5_000_00 },
};

/** Limits of a tier in a currency: the `KYC_LIMITS` entry when present, else the defaults scaled to the currency. */
export function limitsForTier(tier: KycTier, currency: string, override?: KycLimitsOverride): KycLimits {
  const configured = override?.[currency]?.[String(tier) as '0' | '1' | '2'];
  if (configured) return { tier, ...configured };
  const unit = currency === 'CDF' ? CDF_PER_USD : 1;
  const d = USD_DEFAULTS[tier];
  return {
    tier,
    maxBalanceMinor: d.maxBalanceMinor * unit,
    maxSingleTransferMinor: d.maxSingleTransferMinor * unit,
    maxDailyOutgoingMinor: d.maxDailyOutgoingMinor * unit,
  };
}
