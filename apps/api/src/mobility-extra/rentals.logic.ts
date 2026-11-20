import { RENTAL_MAX_DAYS, RENTAL_MAX_LEAD_DAYS } from '@caselind/contracts';

const MS_DAY = 86_400_000;
const dayMs = (d: string): number => Date.parse(`${d}T00:00:00.000Z`);

/** Whether a YYYY-MM-DD string is a real calendar date. */
export const isRealDay = (d: string): boolean => {
  const t = dayMs(d);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

/** Number of days of a rental, both ends included (10 to 12 is 3 days). */
export const rentalDays = (startsOn: string, endsOn: string): number => Math.round((dayMs(endsOn) - dayMs(startsOn)) / MS_DAY) + 1;

/** The total the server computes: days times the daily rate. Never typed by the client. */
export const rentalTotalMinor = (days: number, dailyRateMinor: number): number => days * dailyRateMinor;

/** Two inclusive date ranges share at least one day. */
export const periodsOverlap = (a: { from: string; to: string }, b: { from: string; to: string }): boolean => a.from <= b.to && b.from <= a.to;

/** Why a period is not acceptable, or null: real dates, order, 30 days at most, not in the past, not too far ahead. */
export function periodProblem(startsOn: string, endsOn: string, today: string): 'invalid_date' | 'period_order' | 'period_too_long' | 'in_the_past' | 'too_far_ahead' | null {
  if (!isRealDay(startsOn) || !isRealDay(endsOn)) return 'invalid_date';
  if (endsOn < startsOn) return 'period_order';
  if (rentalDays(startsOn, endsOn) > RENTAL_MAX_DAYS) return 'period_too_long';
  if (startsOn < today) return 'in_the_past';
  if (dayMs(startsOn) - dayMs(today) > RENTAL_MAX_LEAD_DAYS * MS_DAY) return 'too_far_ahead';
  return null;
}

export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);
