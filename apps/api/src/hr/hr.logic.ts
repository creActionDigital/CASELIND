import { leaveDays, type LeaveKind } from '@caselind/contracts';

/** Deux congés (bornes comprises) se chevauchent s'ils partagent au moins un jour. Dates AAAA-MM-JJ. */
export const dateRangesOverlap = (a: { startsOn: string; endsOn: string }, b: { startsOn: string; endsOn: string }): boolean =>
  a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

/** Deux créneaux du même jour : intervalles semi-ouverts (18:00 puis 18:00 ne se chevauchent pas). Heures HH:MM. */
export const timeRangesOverlap = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }): boolean =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

export interface BalanceInput {
  kind: LeaveKind;
  status: 'requested' | 'approved';
  startsOn: string;
  endsOn: string;
}

/** Jours du congé qui tombent dans l'année civile `year` (un congé à cheval sur deux années est réparti). */
export function daysInYear(startsOn: string, endsOn: string, year: number): number {
  const from = startsOn > `${year}-01-01` ? startsOn : `${year}-01-01`;
  const to = endsOn < `${year}-12-31` ? endsOn : `${year}-12-31`;
  return to < from ? 0 : leaveDays(from, to);
}

/** Solde indicatif : quota - jours de congé annuel approuvés - jours en attente (aucune règle légale). */
export function leaveBalance(rows: BalanceInput[], quota: number | null, year: number) {
  const byKind = new Map<LeaveKind, number>();
  let pending = 0;
  for (const r of rows) {
    const d = daysInYear(r.startsOn, r.endsOn, year);
    if (r.status === 'approved') byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + d);
    else if (r.kind === 'annual') pending += d;
  }
  const used = byKind.get('annual') ?? 0;
  return {
    year,
    annualQuotaDays: quota,
    annualUsedDays: used,
    annualPendingDays: pending,
    annualRemainingDays: quota === null ? null : quota - used - pending,
    usedByKind: [...byKind].map(([kind, days]) => ({ kind, days })),
  };
}
