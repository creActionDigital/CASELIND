import type { WalletTransaction } from '@caselind/contracts';

export interface DayGroup {
  /** `YYYY-MM-DD` en heure locale. */
  dayKey: string;
  /** Relatif au jour courant, sinon null (l'interface affiche alors la date). */
  relative: 'today' | 'yesterday' | null;
  date: Date;
  items: WalletTransaction[];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKeyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Regroupe par jour local en conservant l'ordre reçu (le plus récent d'abord). */
export function groupByDay(items: readonly WalletTransaction[], now: Date = new Date()): DayGroup[] {
  const today = dayKeyOf(now);
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = dayKeyOf(y);
  const groups: DayGroup[] = [];
  for (const tx of items) {
    const date = new Date(tx.createdAt);
    const key = dayKeyOf(date);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === key) last.items.push(tx);
    else groups.push({ dayKey: key, relative: key === today ? 'today' : key === yesterday ? 'yesterday' : null, date, items: [tx] });
  }
  return groups;
}

export type HistoryRow = { type: 'header'; group: DayGroup } | { type: 'item'; tx: WalletTransaction };

export function flattenGroups(groups: readonly DayGroup[]): HistoryRow[] {
  return groups.flatMap((g) => [{ type: 'header' as const, group: g }, ...g.items.map((tx) => ({ type: 'item' as const, tx }))]);
}

/** Montant signé en unités mineures : positif en entrée, négatif en sortie. */
export const signedMinor = (tx: Pick<WalletTransaction, 'direction' | 'amountMinor'>): number =>
  tx.direction === 'in' ? tx.amountMinor : -tx.amountMinor;

export type Period = 'week' | 'month' | 'year';

/** La transaction date-t-elle de la période en cours (7 jours glissants, mois ou année civils) ? */
export function inPeriod(createdAt: string, period: Period, now: Date = new Date()): boolean {
  const d = new Date(createdAt);
  if (period === 'week') return now.getTime() - d.getTime() < 7 * 24 * 3600 * 1000 && d.getTime() <= now.getTime() + 60_000;
  if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  return d.getFullYear() === now.getFullYear();
}
