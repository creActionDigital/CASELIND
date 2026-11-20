import type { AnalyticsPoint, CreatorDay } from '@caselind/contracts';
import { parseWalletAmount, type AmountIssue } from '../wallet/amount';

// ---- hashtags dans le texte ------------------------------------------------------------------

export interface TextPart {
  text: string;
  /** Présent quand le morceau est un hashtag cliquable (en minuscules, sans le #). */
  tag?: string;
}

// Même règle que le serveur : un tag suit un espace ou une ponctuation, 1 à 40 lettres/chiffres/_, au moins une lettre.
const TAG_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_/&#])#([\p{L}\p{N}_]{1,40})(?![\p{L}\p{N}_#])`, 'gu');

/** Découpe un texte en morceaux simples et hashtags ; recoller les morceaux redonne le texte d'origine. */
export function splitHashtags(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[1]!;
    if (!/\p{L}/u.test(tag)) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], tag: tag.toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// ---- impressions -----------------------------------------------------------------------------

/** Durée minimale d'affichage avant de compter une impression. */
export const IMPRESSION_MIN_MS = 1000;
export const IMPRESSION_BATCH = 50;

/**
 * Suit les publications visibles à l'écran : un id n'est rapporté qu'après `IMPRESSION_MIN_MS` de visibilité continue,
 * une seule fois par session (rien n'est compté pour un défilement rapide). Pure : l'horloge est fournie par l'appelant.
 */
export class ImpressionTracker {
  private readonly since = new Map<string, number>();
  private readonly reported = new Set<string>();

  /** `visibleIds` : l'ensemble complet des publications actuellement visibles. */
  update(visibleIds: string[], now: number): void {
    const visible = new Set(visibleIds);
    for (const id of [...this.since.keys()]) if (!visible.has(id)) this.since.delete(id);
    for (const id of visible) if (!this.since.has(id) && !this.reported.has(id)) this.since.set(id, now);
  }

  /** Ids visibles depuis assez longtemps ; ils sont marqués comme rapportés (au plus un lot de 50). */
  take(now: number): string[] {
    const ready: string[] = [];
    for (const [id, t] of this.since) {
      if (now - t >= IMPRESSION_MIN_MS) ready.push(id);
      if (ready.length >= IMPRESSION_BATCH) break;
    }
    for (const id of ready) {
      this.since.delete(id);
      this.reported.add(id);
    }
    return ready;
  }

  /** Après un envoi échoué : on pourra les rapporter de nouveau. */
  release(ids: string[]): void {
    for (const id of ids) this.reported.delete(id);
  }
}

// ---- fil -------------------------------------------------------------------------------------

/** Garde la première occurrence de chaque id (une publication sponsorisée peut revenir sur la page suivante). */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

// ---- tableau de bord -------------------------------------------------------------------------

export type CreatorMetric = 'impressions' | 'uniqueViewers' | 'reactions' | 'comments' | 'newFollowers';

export function seriesPoints(series: CreatorDay[], metric: CreatorMetric): AnalyticsPoint[] {
  return series.map((d) => ({ day: d.date, value: d[metric] }));
}

// ---- pourboires et boosts --------------------------------------------------------------------

/** Plafonds miroirs du serveur (USD en unités mineures ; ×2800 en CDF). Le serveur reste la référence. */
const CAP_USD = { tip: 5_000, boostMin: 100, boostMax: 10_000 } as const;
export const scaleCap = (usdMinor: number, currency: string): number => usdMinor * (currency === 'CDF' ? 2800 : 1);
export const tipMax = (currency: string): number => scaleCap(CAP_USD.tip, currency);
export const boostRange = (currency: string): { min: number; max: number } => ({ min: scaleCap(CAP_USD.boostMin, currency), max: scaleCap(CAP_USD.boostMax, currency) });

export type CreatorAmountIssue = AmountIssue | 'too_low';

export function parseTipAmount(input: string, currency: string): { minor: number } | { issue: CreatorAmountIssue } {
  return parseWalletAmount(input, currency, tipMax(currency));
}

export function parseBoostBudget(input: string, currency: string): { minor: number } | { issue: CreatorAmountIssue } {
  const { min, max } = boostRange(currency);
  const r = parseWalletAmount(input, currency, max);
  if ('issue' in r) return r;
  return r.minor < min ? { issue: 'too_low' } : r;
}

/** Nombre de jours d'un boost : entier de 1 à 14, sinon null. */
export function parseBoostDays(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 14 ? n : null;
}
