import type { WalletAlertRule, WalletAlertSeverity } from '@caselind/contracts';

/**
 * Anomaly rules of the SANDBOX wallet (test funds). They only raise an INFORMATION alert for the user: no transfer is ever
 * blocked, so a false positive costs nothing. Pure functions: the service gathers the figures, these decide.
 *
 *  - amount_outlier       the amount is above 5 x the median of the user's previous 30 sends in that currency (at least 5 sends).
 *  - burst                more than 5 sends in 10 minutes (this one included).
 *  - new_recipient_large  first send to this recipient, and the amount is above 50 % of the KYC daily limit.
 *  - many_recipients      more than 8 distinct recipients within one hour (this one included).
 */
export const ANOMALY = {
  outlierFactor: 5,
  outlierMinSends: 5,
  historySize: 30,
  burstMax: 5,
  burstWindowMs: 10 * 60_000,
  newRecipientShare: 0.5,
  recipientsMax: 8,
  recipientsWindowMs: 60 * 60_000,
} as const;

export interface AnomalyInput {
  amountMinor: number;
  /** Amounts of the previous sends in the same currency (the 30 most recent ones are used by the caller). */
  previousAmounts: number[];
  /** Sends in the last 10 minutes, the current one included. */
  sendsLast10Min: number;
  /** Distinct recipients in the last hour, the current one included. */
  distinctRecipientsLastHour: number;
  isFirstToRecipient: boolean;
  /** KYC daily limit of the user in this currency (null when unknown). */
  dailyLimitMinor: number | null;
}

export interface AnomalyHit {
  rule: WalletAlertRule;
  severity: WalletAlertSeverity;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function evaluateAnomalies(i: AnomalyInput): AnomalyHit[] {
  const hits: AnomalyHit[] = [];
  if (i.previousAmounts.length >= ANOMALY.outlierMinSends && i.amountMinor > ANOMALY.outlierFactor * median(i.previousAmounts)) {
    hits.push({ rule: 'amount_outlier', severity: 'warn' });
  }
  if (i.sendsLast10Min > ANOMALY.burstMax) hits.push({ rule: 'burst', severity: 'warn' });
  if (i.isFirstToRecipient && i.dailyLimitMinor !== null && i.amountMinor > ANOMALY.newRecipientShare * i.dailyLimitMinor) {
    hits.push({ rule: 'new_recipient_large', severity: 'info' });
  }
  if (i.distinctRecipientsLastHour > ANOMALY.recipientsMax) hits.push({ rule: 'many_recipients', severity: 'high' });
  return hits;
}
