export type DayKey = 'today' | 'yesterday' | 'week' | 'older';

/** Jour du calendrier local (minuit) d'une date. */
const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dayKeyOf(iso: string, now: Date): DayKey {
  const diff = Math.round((dayStart(now) - dayStart(new Date(iso))) / 86_400_000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  return diff < 7 ? 'week' : 'older';
}

/** Regroupe une liste déjà triée (récent d'abord) en sections Aujourd'hui / Hier / Cette semaine / Plus ancien ; sections vides omises. */
export function groupByDay<T extends { createdAt: string }>(items: T[], now = new Date()): { key: DayKey; data: T[] }[] {
  const order: DayKey[] = ['today', 'yesterday', 'week', 'older'];
  const out = new Map<DayKey, T[]>();
  for (const it of items) {
    const k = dayKeyOf(it.createdAt, now);
    out.set(k, [...(out.get(k) ?? []), it]);
  }
  return order.filter((k) => out.has(k)).map((k) => ({ key: k, data: out.get(k)! }));
}
