import type { HealthEntryKind } from '@caselind/contracts';
import { ApiRequestError } from '../lib/api';
import type { MessageKey } from '../i18n';

export const ENTRY_KINDS: HealthEntryKind[] = ['allergy', 'condition', 'medication', 'vaccination', 'measurement', 'symptom', 'note'];
export const kindKey = (k: HealthEntryKind): MessageKey => `health.kind.${k}` as MessageKey;

/** Le serveur répond 403 `consent_required` tant que le consentement n'est pas donné (ou après son retrait). */
export const isConsentRequired = (err: unknown): boolean => err instanceof ApiRequestError && err.status === 403 && err.detail<string>('reason') === 'consent_required';

/** « 8:00, 20h30 ; 08:00 » -> ['08:00', '20:30'] triés et sans doublon ; `null` si une heure est invalide ou s'il y en a plus de 6. */
export function parseTimes(input: string): string[] | null {
  const parts = input.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 6) return null;
  const out = new Set<string>();
  for (const p of parts) {
    const m = /^(\d{1,2})[:hH](\d{2})$/.exec(p);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    out.add(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return [...out].sort();
}

/** Date locale du jour au format AAAA-MM-JJ. */
export const todayLocal = (now = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Minutes à l'est d'UTC de l'horloge de l'appareil (120 pour Goma). */
export const deviceUtcOffsetMinutes = (now = new Date()): number => -now.getTimezoneOffset();

export const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// ---- Lot 18b ----------------------------------------------------------------------------------

export const PRO_KINDS = ['doctor', 'dentist', 'laboratory', 'pharmacist', 'nurse', 'psychologist', 'other'] as const;
export const proKindKey = (k: (typeof PRO_KINDS)[number]): MessageKey => `health.pro.kind.${k}` as MessageKey;

/** « 2026-12-01 », « 14:30 » -> instant ISO (heure locale de l'appareil) ; `null` si invalide ou passé. */
export function localToIso(date: string, time: string, now = new Date()): string | null {
  const t = /^(\d{1,2})[:hH](\d{2})$/.exec(time.trim());
  if (!t || !isDate(date)) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const when = new Date(y, m - 1, d, Number(t[1]), Number(t[2]));
  return Number.isNaN(when.getTime()) || Number(t[1]) > 23 || Number(t[2]) > 59 || when.getTime() <= now.getTime() ? null : when.toISOString();
}

/** Actions proposées sur un rendez-vous selon le rôle et l'état (le serveur reste la référence). */
export type AppointmentAction = 'confirm' | 'decline' | 'cancel' | 'complete';
export function appointmentActions(role: 'patient' | 'professional', status: string): AppointmentAction[] {
  if (role === 'patient') return status === 'requested' || status === 'confirmed' ? ['cancel'] : [];
  if (status === 'requested') return ['confirm', 'decline'];
  if (status === 'confirmed') return ['complete', 'cancel'];
  return [];
}

export function healthProErrorKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiRequestError)) return null;
  if (err.status === 403 && err.code === 'feature_disabled') return 'health.err.disabled';
  const reason = err.detail<string>('reason');
  const map: Record<string, MessageKey> = {
    slot_taken: 'health.err.slot_taken',
    invalid_transition: 'health.err.invalid_transition',
    not_started: 'health.err.not_started',
    already_registered: 'health.err.already_registered',
    already_issued: 'health.err.already_issued',
    appointment_not_completed: 'health.err.not_completed',
    slot_unavailable: 'health.err.slot_unavailable',
  };
  return reason && map[reason] ? map[reason]! : null;
}

// ---- Lot 18c ----------------------------------------------------------------------------------

/** « 08:00-12:00, 14h-17:30 » -> plages du jour ; [] si vide ; null si une plage est invalide (début >= fin) ou s'il y en a plus de 4. */
export function parseDayWindows(day: number, input: string): { day: number; start: string; end: string }[] | null {
  const parts = input.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 4) return null;
  const out: { day: number; start: string; end: string }[] = [];
  for (const p of parts) {
    const m = /^(\d{1,2})[:hH](\d{0,2})\s*-\s*(\d{1,2})[:hH](\d{0,2})$/.exec(p);
    if (!m) return null;
    const [h1, m1, h2, m2] = [Number(m[1]), Number(m[2] || 0), Number(m[3]), Number(m[4] || 0)];
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
    const f = (h: number, mi: number) => `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    const [start, end] = [f(h1, m1), f(h2, m2)];
    if (start >= end) return null;
    out.push({ day, start, end });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1)).every((w, i, all) => i === 0 || all[i - 1]!.end <= w.start) ? out : null;
}
