import { describe, expect, it } from 'vitest';
import { type AnomalyInput, evaluateAnomalies, median } from './anomaly.rules.js';

const base: AnomalyInput = {
  amountMinor: 1_000,
  previousAmounts: [1_000, 1_000, 1_000, 1_000, 1_000],
  sendsLast10Min: 1,
  distinctRecipientsLastHour: 1,
  isFirstToRecipient: false,
  dailyLimitMinor: 10_000,
};

const rulesOf = (over: Partial<AnomalyInput>) => evaluateAnomalies({ ...base, ...over }).map((h) => h.rule);

describe('anomaly rules (pure)', () => {
  it('median', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 9, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  const cases: Array<[string, Partial<AnomalyInput>, string[]]> = [
    ['normal send', {}, []],
    ['exactly 5 x median is not an outlier', { amountMinor: 5_000 }, []],
    ['above 5 x median', { amountMinor: 5_001 }, ['amount_outlier']],
    ['fewer than 5 previous sends: no outlier rule', { amountMinor: 900_000, previousAmounts: [1_000, 1_000, 1_000, 1_000] }, []],
    ['5 sends in 10 min is fine', { sendsLast10Min: 5 }, []],
    ['6 sends in 10 min', { sendsLast10Min: 6 }, ['burst']],
    ['first send to a recipient, exactly 50 % of the daily limit', { isFirstToRecipient: true, amountMinor: 5_000, previousAmounts: [] }, []],
    ['first send to a recipient above 50 %', { isFirstToRecipient: true, amountMinor: 5_001, previousAmounts: [] }, ['new_recipient_large']],
    ['known recipient above 50 %', { isFirstToRecipient: false, amountMinor: 9_000, previousAmounts: [] }, []],
    ['unknown daily limit', { isFirstToRecipient: true, amountMinor: 9_000, previousAmounts: [], dailyLimitMinor: null }, []],
    ['8 recipients in an hour is fine', { distinctRecipientsLastHour: 8 }, []],
    ['9 recipients in an hour', { distinctRecipientsLastHour: 9 }, ['many_recipients']],
    [
      'several rules at once',
      { amountMinor: 9_000, sendsLast10Min: 7, distinctRecipientsLastHour: 12, isFirstToRecipient: true },
      ['amount_outlier', 'burst', 'new_recipient_large', 'many_recipients'],
    ],
  ];
  it.each(cases)('%s', (_name, over, expected) => {
    expect(rulesOf(over)).toEqual(expected);
  });

  it('severities', () => {
    const hits = evaluateAnomalies({ ...base, amountMinor: 9_000, sendsLast10Min: 7, distinctRecipientsLastHour: 12, isFirstToRecipient: true });
    expect(Object.fromEntries(hits.map((h) => [h.rule, h.severity]))).toEqual({
      amount_outlier: 'warn',
      burst: 'warn',
      new_recipient_large: 'info',
      many_recipients: 'high',
    });
  });
});
