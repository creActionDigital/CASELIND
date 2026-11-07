import { SCHEDULE_MAX_SECONDS, SCHEDULE_MIN_SECONDS, type Conversation, type ForwardResult } from '@caselind/contracts';
import type { CachedMessage, MessagePages } from './cache';

/* Fonctions pures du lot M5d : expiration locale, programmation, brouillons, transfert. */

/** Plus long délai accepté par setTimeout (au-delà : exécution immédiate). */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/* ---------- Expiration locale ---------- */

export function isExpired(m: Pick<CachedMessage, 'expiresAt'>, now: number): boolean {
  return !!m.expiresAt && new Date(m.expiresAt).getTime() <= now;
}

/** Retire du cache les messages expirés à `now`. Retourne la même référence s'il n'y en a pas. */
export function removeExpired(data: MessagePages | undefined, now: number): MessagePages | undefined {
  if (!data || !data.pages.some((p) => p.items.some((m) => isExpired(m, now)))) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((m) => !isExpired(m, now)) })) };
}

/** Délai (ms) avant la prochaine expiration, borné pour setTimeout ; null s'il n'y a rien à surveiller. */
export function nextExpiryDelay(items: Pick<CachedMessage, 'expiresAt'>[], now: number): number | null {
  let min: number | null = null;
  for (const m of items) {
    if (!m.expiresAt) continue;
    const at = new Date(m.expiresAt).getTime();
    if (Number.isNaN(at)) continue;
    if (min === null || at < min) min = at;
  }
  if (min === null) return null;
  // +50 ms : le serveur ne sert plus le message à partir de l'instant exact.
  return Math.min(Math.max(min - now + 50, 0), MAX_TIMER_MS);
}

/* ---------- Message programmé ---------- */

export type ScheduleCheck = 'ok' | 'invalid' | 'too_soon' | 'too_far';

export function checkSchedule(at: Date | null, now: number): ScheduleCheck {
  if (!at || Number.isNaN(at.getTime())) return 'invalid';
  const seconds = (at.getTime() - now) / 1000;
  if (seconds < SCHEDULE_MIN_SECONDS) return 'too_soon';
  if (seconds > SCHEDULE_MAX_SECONDS) return 'too_far';
  return 'ok';
}

/** Date locale « AAAA-MM-JJ » + heure « HH:MM » -> Date, ou null si le format est invalide. */
export function parseLocalDateTime(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const h = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !h) return null;
  const [y, mo, da, hh, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(h[1]), Number(h[2])];
  if (hh > 23 || mi > 59) return null;
  const out = new Date(y, mo - 1, da, hh, mi, 0, 0);
  // Refuse les dates qui débordent (31 février).
  if (out.getFullYear() !== y || out.getMonth() !== mo - 1 || out.getDate() !== da) return null;
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const formatDateField = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const formatTimeField = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/* ---------- Brouillon ---------- */

export const DRAFT_DEBOUNCE_MS = 800;

export interface Debouncer<A extends unknown[]> {
  call(...args: A): void;
  /** Exécute immédiatement l'appel en attente, s'il y en a un. */
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

/** Anti-rebond : seule la dernière valeur est livrée, après `ms` sans nouvel appel. */
export function createDebouncer<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout },
): Debouncer<A> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let last: A | null = null;
  const run = () => {
    handle = null;
    const args = last;
    last = null;
    if (args) fn(...args);
  };
  return {
    call(...args) {
      last = args;
      if (handle !== null) timers.clear(handle);
      handle = timers.set(run, ms);
    },
    flush() {
      if (handle !== null) timers.clear(handle);
      run();
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      last = null;
    },
    pending: () => handle !== null,
  };
}

/** Un brouillon reçu d'un autre appareil remplace le texte seulement si l'utilisateur n'est pas en train d'écrire. */
export function shouldApplyRemoteDraft(input: {
  remote: string | null;
  current: string;
  lastSaved: string | null;
  hasPendingSave: boolean;
}): boolean {
  if (input.hasPendingSave) return false;
  if ((input.remote ?? '') === input.current) return false;
  // Écho de notre propre enregistrement : ne pas écraser ce qui a été tapé depuis.
  if (input.remote === input.lastSaved) return false;
  return true;
}

export function draftPreview(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

/* ---------- Transfert ---------- */

export const FORWARD_MAX = 10;

export interface ForwardSummary {
  sent: string[];
  failed: string[];
  allSent: boolean;
}

/** Agrège les résultats par destination, dans l'ordre demandé. Une destination sans résultat compte comme impossible. */
export function summarizeForward(requested: string[], results: ForwardResult[]): ForwardSummary {
  const byId = new Map(results.map((r) => [r.conversationId, r]));
  const sent: string[] = [];
  const failed: string[] = [];
  for (const id of requested) {
    if (byId.get(id)?.status === 'sent') sent.push(id);
    else failed.push(id);
  }
  return { sent, failed, allSent: failed.length === 0 };
}

/** Ajoute/retire une destination en respectant la limite de 10. */
export function toggleDestination(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return selected.length >= FORWARD_MAX ? selected : [...selected, id];
}

/* ---------- Éphémères : droits ---------- */

/** Direct : l'un ou l'autre ; groupe : admin ou owner. */
export function canSetDisappearing(c: Pick<Conversation, 'kind' | 'myRole'>): boolean {
  return c.kind === 'direct' || c.myRole === 'owner' || c.myRole === 'admin';
}

export const DISAPPEARING_OPTIONS: (86400 | 604800 | 7776000 | null)[] = [null, 86400, 604800, 7776000];
