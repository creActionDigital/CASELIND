import type { AiAction, AiActionResult, ConsentKind, ConversationMember, NaturalFilters, TranslationLocale } from '@caselind/contracts';
import { ApiRequestError } from '../lib/api';

/** Pure helpers of the assistant extras: consents, mentions, translation, action cards, natural search chips. */

/** The consent a 409 `consent_required` asks for, or null for any other error. */
export function consentNeeded(err: unknown): ConsentKind | null {
  if (!(err instanceof ApiRequestError) || err.code !== 'consent_required') return null;
  const kind = err.detail<string>('kind');
  return kind === 'translation' || kind === 'ai_processing' ? kind : null;
}

/** Locale to translate into: the app language (a message already in it gives the same text back). */
export function translationTarget(locale: string): TranslationLocale {
  return locale === 'en' || locale === 'sw' ? locale : 'fr';
}

// ---- mentions ------------------------------------------------------------------------------------

export interface MentionQuery {
  /** Index of the `@` in the text. */
  start: number;
  query: string;
}

/** The `@handle` being typed at the end of the text, if any. */
export function mentionQuery(text: string): MentionQuery | null {
  const m = /(^|\s)@([A-Za-z0-9_.]{0,30})$/.exec(text);
  return m ? { start: m.index + m[1]!.length, query: m[2]! } : null;
}

/** Active members matching what was typed (handle or name prefix), never oneself, at most 5. */
export function suggestMembers(members: readonly ConversationMember[], query: string, myId: string): ConversationMember[] {
  const q = query.toLowerCase();
  return members
    .filter((m) => m.userId !== myId && (q === '' || m.handle.toLowerCase().startsWith(q) || m.displayName.toLowerCase().startsWith(q)))
    .slice(0, 5);
}

export function applyMention(text: string, mq: MentionQuery, handle: string): string {
  return `${text.slice(0, mq.start)}@${handle} `;
}

/** Ids of the members whose `@handle` appears in the text (what the server stores in `mentions`). */
export function mentionIds(text: string, members: readonly Pick<ConversationMember, 'userId' | 'handle'>[], myId: string): string[] {
  const ids = new Set<string>();
  for (const m of members) {
    if (m.userId === myId) continue;
    const re = new RegExp(`(^|\\s)@${m.handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_.])`, 'i');
    if (re.test(text)) ids.add(m.userId);
  }
  return [...ids];
}

export interface BodySegment {
  text: string;
  bold: boolean;
}

/** Body cut into plain and bold (mention) parts; only the handles of really mentioned members are bold. */
export function splitMentions(body: string, handles: readonly string[]): BodySegment[] {
  if (handles.length === 0) return [{ text: body, bold: false }];
  const alt = handles.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(^|\\s)(@(?:${alt}))(?![A-Za-z0-9_.])`, 'gi');
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const start = m.index + m[1]!.length;
    if (start > last) out.push({ text: body.slice(last, start), bold: false });
    out.push({ text: m[2]!, bold: true });
    last = start + m[2]!.length;
  }
  if (last < body.length) out.push({ text: body.slice(last), bold: false });
  return out.length > 0 ? out : [{ text: body, bold: false }];
}

// ---- assistant actions ----------------------------------------------------------------------------

/** A card is actionable until it is decided or expired. */
export function isPending(a: Pick<AiAction, 'status' | 'expiresAt'>, now = Date.now()): boolean {
  return a.status === 'proposed' && new Date(a.expiresAt).getTime() > now;
}

/** Message key for an action error (`details.reason`), or null for the generic translator. */
export function actionErrorKey(err: unknown): 'aiact.err.expired' | 'aiact.err.decided' | 'aiact.err.off' | null {
  if (!(err instanceof ApiRequestError)) return null;
  const reason = err.detail<string>('reason');
  if (reason === 'action_expired') return 'aiact.err.expired';
  if (reason === 'action_not_pending') return 'aiact.err.decided';
  if (reason === 'ai_actions_disabled') return 'aiact.err.off';
  return null;
}

const price = (minor: number, currency: string): string => `${(minor / 100).toFixed(2)} ${currency}`;

/** One line per result item, ready to display. */
export function resultLines(r: AiActionResult): string[] {
  switch (r.kind) {
    case 'products':
      return r.items.map((p) => `${p.title} · ${price(p.minPriceMinor, p.currency)} · ${p.orgName}`);
    case 'places':
      return r.items.map((p) => `${p.name}${p.city ? ` · ${p.city}` : ''} · ${p.distanceKm.toFixed(1)} km`);
    case 'summary':
      return [r.text];
    case 'cart':
      return r.lines.map((l) => `${l.quantity} × ${l.title} · ${price(l.priceMinor, l.currency)}`);
    case 'open_screen':
      return [];
  }
}

// ---- natural search -------------------------------------------------------------------------------

export type FilterKey = 'keywords' | 'categorySlug' | 'price' | 'city' | 'placeKind' | 'cheapFirst';

export interface FilterChip {
  key: FilterKey;
  /** Raw label (a value, or the price range); the screen localises the fixed words. */
  label: string;
}

/** The chips of an interpretation: one per filter that is set. */
export function filterChips(f: NaturalFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.keywords) chips.push({ key: 'keywords', label: f.keywords });
  if (f.categorySlug) chips.push({ key: 'categorySlug', label: f.categorySlug });
  if (f.minPriceMinor !== null || f.maxPriceMinor !== null) {
    const cur = f.currency ?? '';
    const range = f.minPriceMinor !== null && f.maxPriceMinor !== null ? `${f.minPriceMinor / 100}–${f.maxPriceMinor / 100}` : f.maxPriceMinor !== null ? `≤ ${f.maxPriceMinor / 100}` : `≥ ${f.minPriceMinor! / 100}`;
    chips.push({ key: 'price', label: `${range} ${cur}`.trim() });
  }
  if (f.city) chips.push({ key: 'city', label: f.city });
  if (f.placeKind) chips.push({ key: 'placeKind', label: f.placeKind });
  if (f.cheapFirst) chips.push({ key: 'cheapFirst', label: '' });
  return chips;
}

/** The filters without the one the user removed from the chips. */
export function removeFilter(f: NaturalFilters, key: FilterKey): NaturalFilters {
  switch (key) {
    case 'keywords':
      return { ...f, keywords: null };
    case 'categorySlug':
      return { ...f, categorySlug: null };
    case 'price':
      return { ...f, minPriceMinor: null, maxPriceMinor: null, currency: null };
    case 'city':
      return { ...f, city: null };
    case 'placeKind':
      return { ...f, placeKind: null };
    case 'cheapFirst':
      return { ...f, cheapFirst: false };
  }
}
