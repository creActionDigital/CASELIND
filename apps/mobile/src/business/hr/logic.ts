import { leaveDays, type CreateLeaveRequest, type CreateShiftRequest, type LeaveKind, type Shift } from '@caselind/contracts';
import { minorDigits } from '../../seller/money';

/** Logique pure des RH (congés, plannings, registre de salaire) : validation de saisie et calculs d'affichage. */

const MS_DAY = 86_400_000;

/** AAAA-MM-JJ valide (le 31 février est refusé) ? */
export function isDate(s: string): boolean {
  const t = Date.parse(`${s}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * MS_DAY).toISOString().slice(0, 10);
}

/** Lundi de la semaine de `date` (semaine du lundi au dimanche). */
export function weekStart(date: string): string {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

export const weekDays = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export interface LeaveForm {
  kind: LeaveKind;
  startsOn: string;
  endsOn: string;
  reason: string;
}

export type LeaveFormError = 'startsOn' | 'endsOn' | 'endBeforeStart' | 'tooLong';

/** Jours calendaires annoncés avant l'envoi (le serveur recalcule) ; null si les dates sont invalides. */
export function previewLeaveDays(f: Pick<LeaveForm, 'startsOn' | 'endsOn'>): number | null {
  if (!isDate(f.startsOn) || !isDate(f.endsOn) || f.endsOn < f.startsOn) return null;
  return leaveDays(f.startsOn, f.endsOn);
}

export function buildLeave(f: LeaveForm): { ok: CreateLeaveRequest } | { error: LeaveFormError } {
  if (!isDate(f.startsOn)) return { error: 'startsOn' };
  if (!isDate(f.endsOn)) return { error: 'endsOn' };
  if (f.endsOn < f.startsOn) return { error: 'endBeforeStart' };
  if (leaveDays(f.startsOn, f.endsOn) > 366) return { error: 'tooLong' };
  const reason = f.reason.trim();
  return { ok: { kind: f.kind, startsOn: f.startsOn, endsOn: f.endsOn, ...(reason ? { reason } : {}) } };
}

export interface ShiftForm {
  userId: string | null;
  shiftDate: string;
  startsAt: string;
  endsAt: string;
  note: string;
}
export type ShiftFormError = 'employee' | 'date' | 'time' | 'order';

export function buildShift(f: ShiftForm): { ok: CreateShiftRequest } | { error: ShiftFormError } {
  if (!f.userId) return { error: 'employee' };
  if (!isDate(f.shiftDate)) return { error: 'date' };
  if (!isTime(f.startsAt) || !isTime(f.endsAt)) return { error: 'time' };
  if (f.startsAt >= f.endsAt) return { error: 'order' };
  const note = f.note.trim();
  return { ok: { userId: f.userId, shiftDate: f.shiftDate, startsAt: f.startsAt, endsAt: f.endsAt, ...(note ? { note } : {}) } };
}

/** Créneaux regroupés par jour (jours sans créneau compris), dans l'ordre horaire. */
export function shiftsByDay(shifts: Shift[], days: string[]): { date: string; items: Shift[] }[] {
  return days.map((date) => ({
    date,
    items: shifts.filter((s) => s.shiftDate === date).sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.userId < b.userId ? -1 : 1)),
  }));
}

/** « AAAA-MM » -> « AAAA-MM-01 » (1er du mois) ; null si invalide. */
export function periodOf(input: string): string | null {
  const s = input.trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? `${s}-01` : null;
}

/** Montant brut déclaré : « 1250,50 » -> 125050 ; zéro accepté ; null si invalide. Aucun calcul de paie. */
export function parseGross(input: string, currency: string): number | null {
  const s = input.trim().replace(/[\s ]/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > minorDigits(currency)) return null;
  const minor = Number(m[1] + frac.padEnd(minorDigits(currency), '0'));
  return Number.isSafeInteger(minor) && minor <= 1_000_000_000_000 ? minor : null;
}

/** Entier de 0 à 365 (quota annuel de congés) ; chaîne vide = pas de quota (null) ; undefined si invalide. */
export function parseQuota(input: string): number | null | undefined {
  const s = input.trim();
  if (s === '') return null;
  if (!/^\d{1,3}$/.test(s)) return undefined;
  return Number(s) <= 365 ? Number(s) : undefined;
}
