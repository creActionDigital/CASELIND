import type { AnalyticsMoneySeries, AnalyticsPoint } from '@caselind/contracts';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in UTC: every series is cut on UTC days so the result never depends on the server time zone. */
export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

/** The `days` UTC days ending today (inclusive), oldest first. */
export function lastDays(now: Date, days: number): string[] {
  const today = Date.parse(utcDay(now));
  return Array.from({ length: days }, (_, i) => utcDay(new Date(today - (days - 1 - i) * DAY_MS)));
}

/** Dense series: a day without a row is 0. Rows outside the window are ignored. */
export function denseSeries(days: string[], rows: { day: string; value: number }[]): AnalyticsPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r.value]));
  return days.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

export const sumPoints = (points: AnalyticsPoint[]): number => points.reduce((n, p) => n + p.value, 0);

export const averageMinor = (amountMinor: number, count: number): number => (count > 0 ? Math.round(amountMinor / count) : 0);

/** Null when the cohort is empty: no rate rather than a misleading 0 %. */
export const ratePercent = (retained: number, cohort: number): number | null => (cohort > 0 ? Math.round((retained * 100) / cohort) : null);

export interface MoneyRow {
  currency: string;
  day: string;
  count: number;
  amountMinor: number;
}

/** One dense money series per currency found in the rows, sorted by currency code. */
export function moneySeries(days: string[], rows: MoneyRow[]): AnalyticsMoneySeries[] {
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  return currencies.map((currency) => {
    const mine = rows.filter((r) => r.currency === currency);
    const byDay = days.map((day) => {
      const r = mine.find((x) => x.day === day);
      return { day, count: r?.count ?? 0, amountMinor: r?.amountMinor ?? 0 };
    });
    const count = byDay.reduce((n, d) => n + d.count, 0);
    const amountMinor = byDay.reduce((n, d) => n + d.amountMinor, 0);
    return { currency, count, amountMinor, averageMinor: averageMinor(amountMinor, count), byDay };
  });
}
