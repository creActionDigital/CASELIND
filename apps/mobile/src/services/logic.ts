/** Logique pure des services et réservations (lot M6b) : créneaux, annulation, actions, éditeur d'offre, disponibilités. */
import type { MessageKey } from '../i18n';
import { parseCoordinate } from '../places/geo';
import { parseDecimalToMinor } from '../seller/money';

const MIN = 60_000;
const HOUR = 3_600_000;

/* ------------------------------------------------------------------ créneaux */

export interface RawSlot {
  startsAt: string;
  endsAt: string;
}
export interface SlotItem extends RawSlot {
  /** « HH:MM » à l'heure locale du prestataire. */
  time: string;
}
export interface SlotDay {
  /** « AAAA-MM-JJ » à l'heure locale du prestataire. */
  day: string;
  slots: SlotItem[];
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** Date locale du prestataire (UTC + décalage fixe, sans changement d'heure) pour un instant. */
function shifted(iso: string, offsetMin: number): Date | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms + offsetMin * MIN);
}

export function localDay(iso: string, offsetMin: number): string | null {
  const d = shifted(iso, offsetMin);
  return d ? `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` : null;
}

export function localTime(iso: string, offsetMin: number): string | null {
  const d = shifted(iso, offsetMin);
  return d ? `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` : null;
}

/**
 * Regroupe les créneaux par jour du prestataire (pas celui de l'appareil), triés, sans doublon.
 * Un créneau à 23:30 UTC un jour tombe le lendemain pour un prestataire à UTC+2.
 */
export function groupSlotsByDay(slots: readonly RawSlot[], offsetMin: number): SlotDay[] {
  const days = new Map<string, Map<string, SlotItem>>();
  for (const s of [...slots].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const day = localDay(s.startsAt, offsetMin);
    const time = localTime(s.startsAt, offsetMin);
    if (!day || !time) continue;
    const bucket = days.get(day) ?? new Map<string, SlotItem>();
    if (!bucket.has(s.startsAt)) bucket.set(s.startsAt, { ...s, time });
    days.set(day, bucket);
  }
  return [...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, m]) => ({ day, slots: [...m.values()] }));
}

/** Fenêtre demandée à /slots : de maintenant à 14 jours (maximum de l'API). */
export function slotsWindow(now: Date, days = 14): { from: string; to: string } {
  const span = Math.min(14, Math.max(1, days)) * 24 * HOUR - MIN;
  return { from: now.toISOString(), to: new Date(now.getTime() + span).toISOString() };
}

/** « UTC+2 », « UTC-3:30 » (pour dire dans quel fuseau sont affichées les heures). */
export function formatOffset(offsetMin: number): string {
  if (offsetMin === 0) return '+0';
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `${sign}${h}:${p2(m)}` : `${sign}${h}`;
}

/** Libellé d'un jour « AAAA-MM-JJ » (ex. « lun. 3 nov. »), calculé en UTC pour ne pas dépendre du fuseau de l'appareil. */
export function dayLabel(day: string, locale: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** « lun. 3 nov., 14:30 » à l'heure du prestataire. */
export function formatWhen(iso: string, offsetMin: number, locale: string): string {
  const day = localDay(iso, offsetMin);
  const time = localTime(iso, offsetMin);
  return day && time ? `${dayLabel(day, locale)}, ${time}` : iso;
}

/* ------------------------------------------------------------------ annulation et actions */

export interface BookingLike {
  status: 'requested' | 'confirmed' | 'completed' | 'cancelled' | 'declined' | 'no_show';
  startsAt: string;
  cancelNoticeHours: number;
  priceKind?: 'fixed' | 'quote';
  quoteStatus?: 'none' | 'proposed' | 'accepted' | 'declined';
}

export const LIVE_STATUSES: readonly BookingLike['status'][] = ['requested', 'confirmed'];
export const isLive = (s: BookingLike['status']) => LIVE_STATUSES.includes(s);

/** Dernier instant où le client peut annuler : `cancelNoticeHours` avant le début. */
export function cancelDeadline(startsAt: string, noticeHours: number): Date | null {
  const ms = Date.parse(startsAt);
  return Number.isNaN(ms) ? null : new Date(ms - noticeHours * HOUR);
}

export type ClientCancel = { ok: true; deadline: Date } | { ok: false; reason: 'status' | 'window'; deadline: Date | null };

/** Règle d'annulation côté client : réservation vivante et délai respecté (la borne est incluse). */
export function clientCancel(b: BookingLike, now: Date): ClientCancel {
  const deadline = cancelDeadline(b.startsAt, b.cancelNoticeHours);
  if (!isLive(b.status)) return { ok: false, reason: 'status', deadline };
  if (!deadline || now.getTime() > deadline.getTime()) return { ok: false, reason: 'window', deadline };
  return { ok: true, deadline };
}

export interface ClientActions {
  cancel: ClientCancel;
  acceptQuote: boolean;
  declineQuote: boolean;
}

export function clientActions(b: BookingLike, now: Date): ClientActions {
  const proposed = b.status === 'requested' && b.priceKind === 'quote' && b.quoteStatus === 'proposed';
  return { cancel: clientCancel(b, now), acceptQuote: proposed, declineQuote: proposed };
}

export function canReview(b: BookingLike & { reviewId: string | null }): boolean {
  return b.status === 'completed' && !b.reviewId;
}

export interface ProviderActions {
  confirm: boolean;
  decline: boolean;
  cancel: boolean;
  complete: boolean;
  noShow: boolean;
  proposeQuote: boolean;
  /** Devis envoyé, en attente de la réponse du client. */
  waitingQuote: boolean;
  /** Offre sur devis : la confirmation attend un devis accepté. */
  needsQuote: boolean;
  /** Terminer / absent seront possibles au début du rendez-vous. */
  waitingStart: boolean;
}

/** Actions du prestataire : le serveur reste juge, ceci évite d'afficher ce qui sera refusé. */
export function providerActions(b: BookingLike, now: Date): ProviderActions {
  const started = Date.parse(b.startsAt) <= now.getTime();
  const requested = b.status === 'requested';
  const confirmed = b.status === 'confirmed';
  const quote = b.priceKind === 'quote';
  const accepted = b.quoteStatus === 'accepted';
  return {
    confirm: requested && (!quote || accepted),
    decline: requested,
    cancel: requested || confirmed,
    complete: confirmed && started,
    noShow: confirmed && started,
    proposeQuote: requested && quote && (b.quoteStatus === 'none' || b.quoteStatus === 'proposed'),
    waitingQuote: requested && quote && b.quoteStatus === 'proposed',
    needsQuote: requested && quote && !accepted && b.quoteStatus !== 'proposed',
    waitingStart: confirmed && !started,
  };
}

/** Évènements triés du plus ancien au plus récent (frise de la réservation). */
export function sortEvents<T extends { createdAt: string }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/* ------------------------------------------------------------------ éditeur d'offre */

export const OFFER_LIMITS = { titleMax: 140, descriptionMax: 2000, guaranteeMax: 200, durationMin: 15, durationMax: 720, noticeMax: 720, radiusMax: 100 } as const;
export const MAX_OFFER_PHOTOS = 10;
export const OFFER_CURRENCIES = ['USD', 'CDF'] as const;

export interface OfferDraft {
  title: string;
  description: string;
  categoryId: string | null;
  priceKind: 'fixed' | 'quote';
  price: string;
  currency: string;
  duration: string;
  cancelNoticeHours: string;
  city: string;
  lat: string;
  lng: string;
  radiusKm: string;
  utcOffsetMinutes: number;
  urgentAvailable: boolean;
  guaranteeNote: string;
  mediaIds: string[];
}

export type OfferField = 'title' | 'description' | 'categoryId' | 'price' | 'currency' | 'duration' | 'cancelNoticeHours' | 'city' | 'position' | 'radiusKm' | 'guaranteeNote';
export type OfferErrors = Partial<Record<OfferField, MessageKey>>;

const intIn = (s: string, min: number, max: number): number | null => {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};

/** Décalage de l'appareil en minutes à l'est d'UTC (Goma : 120). */
export const deviceUtcOffset = (d = new Date()): number => 0 - d.getTimezoneOffset();

export function emptyOfferDraft(utcOffsetMinutes = 120): OfferDraft {
  return {
    title: '',
    description: '',
    categoryId: null,
    priceKind: 'fixed',
    price: '',
    currency: 'USD',
    duration: '60',
    cancelNoticeHours: '24',
    city: 'Goma',
    lat: '',
    lng: '',
    radiusKm: '10',
    utcOffsetMinutes,
    urgentAvailable: false,
    guaranteeNote: '',
    mediaIds: [],
  };
}

/**
 * Validation de l'éditeur. `needsPosition` : une offre individuelle doit donner sa position ; une offre
 * d'organisation peut la laisser vide (emplacement de l'organisation), mais une saisie partielle reste refusée.
 */
export function validateOffer(d: OfferDraft, opts: { needsPosition: boolean }): OfferErrors {
  const e: OfferErrors = {};
  const title = d.title.trim();
  if (!title || title.length > OFFER_LIMITS.titleMax) e.title = 'services.pro.offer.err.title';
  if (d.description.trim().length > OFFER_LIMITS.descriptionMax) e.description = 'services.pro.offer.err.description';
  if (!d.categoryId) e.categoryId = 'services.pro.offer.err.category';
  if (d.priceKind === 'fixed') {
    if (!OFFER_CURRENCIES.includes(d.currency as (typeof OFFER_CURRENCIES)[number])) e.currency = 'services.pro.offer.err.currency';
    if (parseDecimalToMinor(d.price, d.currency) === null) e.price = 'services.pro.offer.err.price';
  }
  if (intIn(d.duration, OFFER_LIMITS.durationMin, OFFER_LIMITS.durationMax) === null) e.duration = 'services.pro.offer.err.duration';
  if (intIn(d.cancelNoticeHours, 0, OFFER_LIMITS.noticeMax) === null) e.cancelNoticeHours = 'services.pro.offer.err.cancelNotice';
  if (!d.city.trim() || d.city.trim().length > 100) e.city = 'services.pro.offer.err.city';
  if (intIn(d.radiusKm, 1, OFFER_LIMITS.radiusMax) === null) e.radiusKm = 'services.pro.offer.err.radius';
  const hasLat = d.lat.trim() !== '';
  const hasLng = d.lng.trim() !== '';
  if (hasLat || hasLng || opts.needsPosition) {
    if (parseCoordinate(d.lat, 'lat') === null || parseCoordinate(d.lng, 'lng') === null) e.position = 'services.pro.offer.err.position';
  }
  if (d.guaranteeNote.trim().length > OFFER_LIMITS.guaranteeMax) e.guaranteeNote = 'services.pro.offer.err.guarantee';
  // Le serveur refuse « urgent » / « garanti » dans le titre ou la description sans l'option correspondante.
  const text = `${d.title} ${d.description}`;
  if (!e.title && ((/urgen/i.test(text) && !d.urgentAvailable) || (/garanti/i.test(text) && !d.guaranteeNote.trim()))) e.title = 'services.pro.offer.err.urgentWord';
  return e;
}

export const hasOfferErrors = (e: OfferErrors): boolean => Object.keys(e).length > 0;

/** Corps de création/mise à jour d'après un brouillon valide (null si la validation échoue). */
export function toOfferBody(d: OfferDraft, status: 'draft' | 'published' | undefined, opts: { needsPosition: boolean; update?: boolean }): Record<string, unknown> | null {
  if (hasOfferErrors(validateOffer(d, opts))) return null;
  const fixed = d.priceKind === 'fixed';
  const body: Record<string, unknown> = {
    title: d.title.trim(),
    description: d.description.trim() || null,
    categoryId: d.categoryId,
    priceKind: d.priceKind,
    durationMin: Number(d.duration),
    cancelNoticeHours: Number(d.cancelNoticeHours),
    city: d.city.trim(),
    radiusKm: Number(d.radiusKm),
    utcOffsetMinutes: d.utcOffsetMinutes,
    urgentAvailable: d.urgentAvailable,
    guaranteeNote: d.guaranteeNote.trim() || null,
    mediaIds: d.mediaIds,
  };
  if (fixed) {
    body.priceMinor = parseDecimalToMinor(d.price, d.currency);
    body.currency = d.currency;
  } else if (opts.update) {
    // Mise à jour vers « sur devis » : le prix précédent est effacé.
    body.priceMinor = null;
    body.currency = null;
  }
  if (d.lat.trim() !== '') {
    body.lat = parseCoordinate(d.lat, 'lat');
    body.lng = parseCoordinate(d.lng, 'lng');
  }
  if (status) body.status = status;
  return body;
}

/* ------------------------------------------------------------------ disponibilités */

export interface RuleDraft {
  key: string;
  weekday: number;
  start: string;
  end: string;
}
export interface ExceptionDraft {
  key: string;
  date: string;
  closed: boolean;
  start: string;
  end: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (s: string) => TIME.test(s.trim());

export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export interface AvailabilityErrors {
  rules: Record<string, MessageKey>;
  exceptions: Record<string, MessageKey>;
}

export function validateAvailability(rules: readonly RuleDraft[], exceptions: readonly ExceptionDraft[]): AvailabilityErrors {
  const out: AvailabilityErrors = { rules: {}, exceptions: {} };
  for (const r of rules) {
    if (!isTime(r.start) || !isTime(r.end) || r.start.trim() >= r.end.trim()) out.rules[r.key] = 'services.pro.avail.err.time';
  }
  const timeBad = new Set(Object.keys(out.rules));
  for (const r of rules) {
    if (timeBad.has(r.key)) continue;
    const clash = rules.some((o) => o.key !== r.key && !timeBad.has(o.key) && o.weekday === r.weekday && o.start < r.end && r.start < o.end);
    if (clash) out.rules[r.key] = 'services.pro.avail.err.overlap';
  }
  const seen = new Set<string>();
  for (const x of exceptions) {
    const date = x.date.trim();
    if (!isRealDate(date)) out.exceptions[x.key] = 'services.pro.avail.err.date';
    else if (seen.has(date)) out.exceptions[x.key] = 'services.pro.avail.err.duplicate';
    else if (!x.closed && (!isTime(x.start) || !isTime(x.end) || x.start.trim() >= x.end.trim())) out.exceptions[x.key] = 'services.pro.avail.err.time';
    seen.add(date);
  }
  return out;
}

export const hasAvailabilityErrors = (e: AvailabilityErrors): boolean => Object.keys(e.rules).length + Object.keys(e.exceptions).length > 0;

/** Corps de PUT .../availability (remplace tout le planning). */
export function toAvailabilityBody(rules: readonly RuleDraft[], exceptions: readonly ExceptionDraft[]) {
  return {
    rules: [...rules].sort((a, b) => a.weekday - b.weekday || (a.start < b.start ? -1 : 1)).map((r) => ({ weekday: r.weekday, start: r.start.trim(), end: r.end.trim() })),
    exceptions: exceptions.map((x) =>
      x.closed ? { date: x.date.trim(), closed: true } : { date: x.date.trim(), closed: false, start: x.start.trim(), end: x.end.trim() },
    ),
  };
}

/** « ça, maçon , plomberie » -> liste nettoyée (40 caractères, 20 au plus, sans doublon). */
export function parseSkills(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,;\n]/)) {
    const s = raw.trim().slice(0, 40);
    const k = s.toLowerCase();
    if (s && !seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out.slice(0, 20);
}

/** Cible d'une notification `booking` (`data.bookingId`). */
export function bookingTarget(data: unknown): { pathname: '/bookings/[id]'; params: { id: string } } | null {
  const id = (data && typeof data === 'object' ? (data as Record<string, unknown>).bookingId : undefined) ?? null;
  return typeof id === 'string' && id ? { pathname: '/bookings/[id]', params: { id } } : null;
}
