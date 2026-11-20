import type { AdminApproval, AnalyticsPoint } from '@caselind/contracts';

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

/** Hauteur de chaque barre (0 pour 0, au moins `min` pour une valeur non nulle, `height` pour le maximum). */
export function barHeights(values: number[], height = 80, min = 2): number[] {
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => (v <= 0 ? 0 : Math.max(min, Math.round((v / max) * height))));
}

export interface SeriesSummary {
  total: number;
  max: number;
  /** Jour du maximum (le plus récent en cas d'égalité), null si la série est vide ou nulle. */
  maxDay: string | null;
  average: number;
}

export function summarizeSeries(points: { day: string; value: number }[]): SeriesSummary {
  const total = points.reduce((n, p) => n + p.value, 0);
  let max = 0;
  let maxDay: string | null = null;
  for (const p of points) {
    if (p.value > 0 && p.value >= max) {
      max = p.value;
      maxDay = p.day;
    }
  }
  return { total, max, maxDay, average: points.length ? Math.round((total / points.length) * 10) / 10 : 0 };
}

/** `2026-03-02` -> `02/03`. */
export function shortDay(day: string | null): string {
  if (!day) return '–';
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

/** Série d'un montant par jour, en points pour le graphique. */
export const amountPoints = (byDay: { day: string; amountMinor: number }[]): AnalyticsPoint[] => byDay.map((d) => ({ day: d.day, value: d.amountMinor }));

export type ApprovalView = Pick<AdminApproval, 'kind' | 'subjectId' | 'payload'>;

const shortId = (id: string | null) => (id ? id.slice(0, 8) : '–');

/** Ce qu'une demande veut faire : nom de l'objet et état voulu (clé `aops.approvals.state.*`). Ne lit que ids et valeurs de réglage. */
export function describeApproval(a: ApprovalView): { name: string; state: string } {
  const p = a.payload;
  switch (a.kind) {
    case 'flag.regulated.change': {
      const patch = (p.patch ?? {}) as { enabled?: boolean };
      return { name: String(p.key ?? a.subjectId ?? '–'), state: patch.enabled === false ? 'off' : 'on' };
    }
    case 'user.platform_role.grant':
      return { name: shortId(a.subjectId), state: String(p.role ?? '') };
    case 'ledger.account.freeze':
      return { name: shortId(a.subjectId), state: p.frozen === false ? 'active' : 'frozen' };
    case 'user.suspend.staff':
      return { name: shortId(a.subjectId), state: 'suspended' };
    case 'sanction.issue':
      return { name: shortId(a.subjectId), state: String(p.kind ?? '') };
    case 'setting.sensitive':
      return { name: String(p.key ?? '–'), state: String(p.scope ?? 'global') };
  }
}

type Timed = Pick<AdminApproval, 'status' | 'expiresAt'>;

export const isExpired = (a: Timed, now: number): boolean => a.status === 'expired' || (a.status === 'pending' && Date.parse(a.expiresAt) <= now);
export const isLivePending = (a: Timed, now: number): boolean => a.status === 'pending' && !isExpired(a, now);

/** Un autre administrateur peut décider d'une demande en attente non expirée ; jamais son auteur. */
export const canDecide = (a: Timed & Pick<AdminApproval, 'requestedBy'>, meId: string | undefined, now: number): boolean =>
  !!meId && a.requestedBy !== meId && isLivePending(a, now);

export const canCancel = (a: Timed & Pick<AdminApproval, 'requestedBy'>, meId: string | undefined, now: number): boolean =>
  !!meId && a.requestedBy === meId && isLivePending(a, now);

export const remainingHours = (expiresAt: string, now: number): number => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 3_600_000));

/** Demandes à traiter (en attente, non expirées) d'un côté, le reste en historique de l'autre. */
export function splitApprovals<T extends Timed>(items: T[], now: number): { pending: T[]; history: T[] } {
  return { pending: items.filter((a) => isLivePending(a, now)), history: items.filter((a) => !isLivePending(a, now)) };
}

/** Statut affiché : une demande restée « en attente » après son échéance s'affiche expirée (le serveur la clôt à la lecture suivante). */
export const displayStatus = (a: Timed, now: number): AdminApproval['status'] => (isExpired(a, now) ? 'expired' : a.status);
