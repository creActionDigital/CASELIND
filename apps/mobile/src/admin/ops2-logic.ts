import { SANCTION_DURATION_DAYS, type SanctionKind } from '@caselind/contracts';

/** Logique pure des écrans d'administration (sanctions, recours, annonces, paramètres, commissions). Le serveur reste la référence. */

export const ALL_KINDS: readonly SanctionKind[] = ['warning', 'mute_posting', 'suspension_temp', 'ban'];

/** Un modérateur n'émet que des avertissements et des blocages de publication ; un administrateur tous les types. */
export function kindsFor(roles: readonly string[] | undefined | null): SanctionKind[] {
  const r = roles ?? [];
  if (r.includes('admin')) return [...ALL_KINDS];
  return r.includes('moderator') ? ['warning', 'mute_posting'] : [];
}

const lightKind = (k: SanctionKind): boolean => k === 'warning' || k === 'mute_posting';

/** Durée saisie : `undefined` = sans durée (avertissement, bannissement), `null` = invalide, sinon un nombre de jours dans la plage du type. */
export function parseDuration(kind: SanctionKind, text: string): number | undefined | null {
  const range = SANCTION_DURATION_DAYS[kind];
  if (!range) return undefined;
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= range.min && n <= range.max ? n : null;
}

export const sanctionReady = (kind: SanctionKind, reason: string, duration: string): boolean =>
  reason.trim().length >= 3 && reason.trim().length <= 300 && parseDuration(kind, duration) !== null;

/** Lever : une sanction en vigueur (active ou en recours) ; un modérateur seulement pour un avertissement ou un blocage. */
export function canLift(s: { status: string; kind: SanctionKind }, roles: readonly string[] | undefined | null): boolean {
  if (s.status !== 'active' && s.status !== 'appealed') return false;
  return (roles ?? []).includes('admin') || lightKind(s.kind);
}

export function canDecide(a: { status: string; sanctionKind: SanctionKind }, roles: readonly string[] | undefined | null): boolean {
  return a.status === 'pending' && ((roles ?? []).includes('admin') || lightKind(a.sanctionKind));
}

/** Côté utilisateur : on ne fait appel que d'une sanction en vigueur qui n'a pas encore de recours. */
export const canAppeal = (s: { status: string; appeal: unknown }): boolean => s.status === 'active' && !s.appeal;

export type AnnouncementAction = 'publish' | 'end' | 'delete';
export const announcementActions = (status: string): AnnouncementAction[] => (status === 'draft' ? ['publish', 'delete'] : status === 'published' ? ['end'] : []);

/** Audience saisie : `all`, `role:<rôle>` ou `country:<CC>` ; `null` si la valeur n'est pas valide. */
export function audienceOf(type: 'all' | 'role' | 'country', value: string): string | null {
  if (type === 'all') return 'all';
  const v = value.trim();
  if (type === 'role') return ['user', 'moderator', 'support', 'admin'].includes(v) ? `role:${v}` : null;
  return /^[A-Za-z]{2}$/.test(v) ? `country:${v.toUpperCase()}` : null;
}

/** « 2026-12-01 » -> ISO à 00:00 UTC ; null si invalide. */
export function dayToIso(day: string): string | null {
  const t = day.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : d.toISOString();
}

export const announcementReady = (title: string, body: string, endDay: string): boolean =>
  title.trim().length >= 1 && title.trim().length <= 80 && body.trim().length >= 1 && body.trim().length <= 500 && dayToIso(endDay) !== null;

/** Réglages que le serveur envoie en double validation. */
export const isSensitiveKey = (key: string): boolean => key === 'commission.defaultBps' || key.startsWith('limits.');

export const SETTING_KEYS = ['support.contact', 'currencies.enabled', 'cities.pilot', 'commission.defaultBps', 'limits.maxOrderMinor'] as const;
export type SettingKeyName = (typeof SETTING_KEYS)[number];

/** Valeur saisie pour une clé : JSON structuré ou texte simple ; `undefined` si invalide (le serveur revalide). */
export function parseSettingValue(key: SettingKeyName, text: string): unknown {
  const t = text.trim();
  switch (key) {
    case 'commission.defaultBps':
    case 'limits.maxOrderMinor':
      return /^\d{1,13}$/.test(t) ? Number(t) : undefined;
    case 'currencies.enabled': {
      const v = t.split(/[\s,;]+/).filter(Boolean).map((s) => s.toUpperCase());
      return v.length > 0 && v.every((c) => c === 'USD' || c === 'CDF') ? [...new Set(v)] : undefined;
    }
    case 'cities.pilot': {
      const v = t.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      return v.length > 0 && v.length <= 50 && v.every((c) => c.length <= 60) ? v : undefined;
    }
    case 'support.contact': {
      try {
        const v: unknown = JSON.parse(t);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
      } catch {
        return /^\S+@\S+\.\S+$/.test(t) ? { email: t } : /^\+?[\d\s-]{3,30}$/.test(t) ? { phone: t } : undefined;
      }
    }
  }
}

/** Portée saisie : « global », « CD » (pays) ou « CD:Goma » (ville) ; `null` si invalide. */
export function scopeOf(input: string): string | null {
  const t = input.trim();
  if (!t || t.toLowerCase() === 'global') return 'global';
  if (/^[A-Za-z]{2}$/.test(t)) return `country:${t.toUpperCase()}`;
  const m = /^([A-Za-z]{2}):([^:]{1,60})$/.exec(t);
  return m ? `city:${m[1]!.toUpperCase()}:${m[2]!.trim()}` : null;
}

/** Points de base -> « 2,5 % » (sans dépendre de la locale du moteur). */
export function bpsLabel(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return `${whole}${frac ? `,${String(frac).padStart(2, '0').replace(/0$/, '')}` : ''} %`;
}

export const wholeBps = (text: string): number | null => (/^\d{1,4}$/.test(text.trim()) && Number(text.trim()) <= 3000 ? Number(text.trim()) : null);
