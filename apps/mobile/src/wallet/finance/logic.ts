import { scheduledRunAt, splitEqual, upcomingRuns, type MoneyRequest, type ScheduledFrequency } from '@caselind/contracts';

/* Logique pure de la finance du portefeuille (mode test) : répartition des parts, prochaines exécutions, saisies de dates. */

export { scheduledRunAt, splitEqual, upcomingRuns };

export interface SplitPreview {
  /** Part de chaque participant, dans l'ordre de saisie. */
  shares: number[];
  /** Part gardée par le créateur. */
  selfMinor: number;
}

/**
 * Partage égal entre les participants ET le créateur : la somme est EXACTE (les premiers reçoivent l'unité en plus, le
 * créateur garde la dernière part). `null` si aucun participant ou si le total ne permet pas 1 unité par personne.
 */
export function equalSplitPreview(totalMinor: number, participants: number): SplitPreview | null {
  if (participants < 1) return null;
  const parts = splitEqual(totalMinor, participants + 1);
  if (parts.length === 0 || parts.some((p) => p < 1)) return null;
  return { shares: parts.slice(0, participants), selfMinor: parts[participants]! };
}

/** Parts saisies : le créateur garde le reste ; refusé si la somme dépasse le total. */
export function customSplitPreview(totalMinor: number, amounts: number[]): SplitPreview | { issue: 'empty' | 'over' } {
  if (amounts.length === 0 || amounts.some((a) => !Number.isSafeInteger(a) || a < 1)) return { issue: 'empty' };
  const sum = amounts.reduce((a, b) => a + b, 0);
  return sum > totalMinor ? { issue: 'over' } : { shares: amounts, selfMinor: totalMinor - sum };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/** `AAAA-MM-JJ` valide (jour réel du calendrier) ou `null`. */
export function parseDateOnly(input: string): string | null {
  const m = DATE_RE.exec(input.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? input.trim() : null;
}

/** `AAAA-MM-JJ HH:MM` (heure locale de l'appareil) -> date ISO UTC, ou `null`. */
export function parseLocalDateTime(input: string): string | null {
  const m = DATETIME_RE.exec(input.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (h > 23 || mi > 59) return null;
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt.toISOString() : null;
}

/** Prochaines dates d'exécution d'un paiement programmé (mêmes règles que le serveur). */
export function nextRunDates(
  p: { firstRunAt: string; frequency: ScheduledFrequency; runsDone: number; maxRuns: number | null; endsOn: string | null },
  count: number,
): string[] {
  return upcomingRuns({ first: new Date(p.firstRunAt), frequency: p.frequency, runsDone: p.runsDone, maxRuns: p.maxRuns, endsOn: p.endsOn }, count).map((d) => d.toISOString());
}

/** Ce que l'utilisateur peut faire d'une demande : payer ou refuser si on la reçoit, annuler si on l'a envoyée. */
export function requestActions(r: Pick<MoneyRequest, 'status' | 'direction'>): { pay: boolean; decline: boolean; cancel: boolean } {
  const open = r.status === 'pending';
  return { pay: open && r.direction === 'received', decline: open && r.direction === 'received', cancel: open && r.direction === 'sent' };
}

/** Jours restants avant l'expiration (0 si passée). */
export function daysLeft(expiresAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000));
}

export const HANDLE_RE = /^[a-zA-Z0-9_.]{3,30}$/;

/** Identifiant saisi (« @nom », collé ou dicté) -> forme normalisée sans @, espaces ni caractères invisibles ; règle unique des écrans du wallet. */
export function cleanHandle(input: string): string {
  return input.normalize('NFKC').replace(/[\s​-‏⁠﻿]/g, '').replace(/^@+/, '').toLowerCase();
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** Date ISO -> `AAAA-MM-JJ HH:MM` en heure locale : l'inverse exact de `parseLocalDateTime`. */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Raccourcis de date (9 h locale) : demain, dans 1 semaine, 1er du mois prochain. */
export function quickDateTime(kind: 'tomorrow' | 'week' | 'month', now: Date = new Date()): string {
  const d = kind === 'month' ? new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + (kind === 'week' ? 7 : 1), 9, 0);
  return formatLocalDateTime(d.toISOString());
}
