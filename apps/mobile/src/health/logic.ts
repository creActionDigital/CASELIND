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
