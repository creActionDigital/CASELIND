import type { Call } from '@caselind/contracts';

/** Logique pure du module D : historique des appels, position partagée, mini-apps récentes, sections de l'administration. */

export type CallRow = {
  id: string;
  conversationId: string;
  kind: 'audio' | 'video';
  direction: 'in' | 'out';
  outcome: 'missed' | 'declined' | 'cancelled' | 'done';
  /** Secondes de communication (0 si non décrochée). */
  seconds: number;
  at: string;
};

/** Ligne d'historique d'un appel, du point de vue de `myId` (un appel sonnant ou actif n'est pas encore de l'historique). */
export function callRow(c: Call, myId: string): CallRow | null {
  if (c.status === 'ringing' || c.status === 'active') return null;
  const answered = c.answeredAt && c.endedAt ? Math.max(0, Math.round((Date.parse(c.endedAt) - Date.parse(c.answeredAt)) / 1000)) : 0;
  const outcome = c.status === 'missed' ? 'missed' : c.status === 'declined' ? 'declined' : c.status === 'cancelled' ? 'cancelled' : 'done';
  return { id: c.id, conversationId: c.conversationId, kind: c.kind, direction: c.callerId === myId ? 'out' : 'in', outcome, seconds: answered, at: c.createdAt };
}

export const callHistory = (calls: Call[], myId: string): CallRow[] =>
  calls.flatMap((c) => { const r = callRow(c, myId); return r ? [r] : []; }).sort((a, b) => b.at.localeCompare(a.at));

// ---- position partagée : un message texte contenant un lien de carte (pas de suivi continu) ----------

const LOC_RE = /^📍 https:\/\/www\.openstreetmap\.org\/\?mlat=(-?\d{1,2}(?:\.\d+)?)&mlon=(-?\d{1,3}(?:\.\d+)?)/;

export function locationBody(lat: number, lon: number): string {
  const r = (n: number) => n.toFixed(5);
  return `📍 https://www.openstreetmap.org/?mlat=${r(lat)}&mlon=${r(lon)}#map=16/${r(lat)}/${r(lon)}`;
}

export function parseLocation(body: string | null | undefined): { lat: number; lon: number; url: string } | null {
  const m = body ? LOC_RE.exec(body.trim()) : null;
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon, url: locationBody(lat, lon).slice(3) };
}

// ---- mini-apps récentes ------------------------------------------------------------------------------

export const RECENTS_MAX = 10;
export const addRecent = (list: string[], id: string): string[] => [id, ...list.filter((x) => x !== id)].slice(0, RECENTS_MAX);
export function parseRecents(raw: string | null | undefined): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

// ---- administration : rubriques regroupées -----------------------------------------------------------

export type AdminSection = 'people' | 'money' | 'ecosystem' | 'platform';
const SECTION_OF: Record<string, AdminSection> = {
  moderation: 'people', sanctions: 'people', appeals: 'people', kyc: 'people', governance: 'people', help: 'people',
  disputes: 'money', approvals: 'money', ledger: 'money', commissions: 'money', walletAlerts: 'money', boosts: 'money',
  miniapps: 'ecosystem', games: 'ecosystem', ai: 'ecosystem', mobility: 'ecosystem', freelance: 'ecosystem', health: 'ecosystem',
};
export const SECTION_ORDER: readonly AdminSection[] = ['people', 'money', 'ecosystem', 'platform'];

/** Regroupe les rubriques par section (les inconnues vont dans « plateforme ») ; les sections vides sont omises. */
export function groupTiles<T extends { id: string }>(tiles: T[]): { section: AdminSection; tiles: T[] }[] {
  return SECTION_ORDER.map((section) => ({ section, tiles: tiles.filter((t) => (SECTION_OF[t.id] ?? 'platform') === section) })).filter((g) => g.tiles.length > 0);
}
