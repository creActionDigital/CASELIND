import type { OpeningHours } from '@caselind/contracts';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Interval = { open: string; close: string };

const pad = (h: string, m: string) => `${h.padStart(2, '0')}:${m}`;
const validTime = (v: string) => v === '24:00' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);

/** « 08:00-12:00, 14:00-18:00 » → intervalles ; vide → fermé (`[]`) ; saisie invalide → `null`. Mêmes règles que l'API. */
export function parseDay(text: string): Interval[] | null {
  const t = text.trim();
  if (!t) return [];
  const out: Interval[] = [];
  for (const part of t.split(',')) {
    const m = /^\s*(\d{1,2}):([0-5]\d)\s*[-–]\s*(\d{1,2}):([0-5]\d)\s*$/.exec(part);
    if (!m) return null;
    const iv = { open: pad(m[1]!, m[2]!), close: pad(m[3]!, m[4]!) };
    if (!validTime(iv.open) || !validTime(iv.close) || iv.open >= iv.close) return null;
    out.push(iv);
  }
  if (out.length > 4) return null;
  return out.every((iv, i) => i === 0 || out[i - 1]!.close <= iv.open) ? out : null;
}

export const formatDay = (day: readonly Interval[] | undefined): string => (day ?? []).map((iv) => `${iv.open}-${iv.close}`).join(', ');

/** Sept saisies → horaires ; `'invalid'` si un jour est invalide ; tous les jours vides → `null` (aucun horaire publié). */
export function buildHours(texts: Record<(typeof DAYS)[number], string>): OpeningHours | null | 'invalid' {
  const hours: OpeningHours = {};
  let any = false;
  for (const d of DAYS) {
    const day = parseDay(texts[d]);
    if (day === null) return 'invalid';
    if (day.length > 0) any = true;
    hours[d] = day;
  }
  return any ? hours : null;
}

/** Une zone par ligne ou séparées par des virgules ; sans doublon (casse ignorée). */
export function parseAreas(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

/** Ouvert maintenant d'après les horaires hebdomadaires (heure locale de l'appareil) ; `null` si aucun horaire. */
export function isOpenNow(hours: OpeningHours | null, now: Date = new Date()): boolean | null {
  if (!hours) return null;
  const key = DAYS[(now.getDay() + 6) % 7]!;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (hours[key] ?? []).some((iv) => iv.open <= hhmm && hhmm < iv.close);
}
