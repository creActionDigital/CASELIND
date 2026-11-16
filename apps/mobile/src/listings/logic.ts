import type { Listing, ListingKind } from '@caselind/contracts';
import type { MessageKey } from '../i18n';
import { parseLocalDateTime } from '../jobs/logic';
import { formatMoney } from '../shop/format';

export const LISTING_KINDS: ListingKind[] = ['property_rent', 'property_sale', 'roommate', 'vehicle', 'used_item', 'lost', 'found'];

export const kindKey = (kind: ListingKind): MessageKey => `listings.kind.${kind}` as MessageKey;

/** Objets perdus ou trouvés : jamais de prix. */
export const hasPrice = (kind: ListingKind): boolean => kind !== 'lost' && kind !== 'found';

export function priceLabel(l: Pick<Listing, 'priceMinor' | 'currency'>, locale: string): string | null {
  return l.priceMinor === null || l.currency === null ? null : formatMoney(l.priceMinor, l.currency, locale);
}

/** "AAAA-MM-JJ" + "HH:MM" (heure locale de l'appareil) vers une date ISO, ou null si invalide. */
export function parseVisitTime(date: string, time: string): string | null {
  return parseLocalDateTime(`${date.trim()} ${time.trim()}`);
}

/** Clé de message pour une erreur 409/400 de demande ou d'annulation de visite (raison lue dans `details.reason`). */
export function visitErrorKey(details: unknown): MessageKey | null {
  if (Array.isArray(details)) return details.some((x) => (x as { path?: unknown })?.path === 'scheduledAt') ? ('listings.visit.err.date' as MessageKey) : null;
  const d = (details ?? {}) as { reason?: unknown };
  if (d.reason === 'visit_exists') return 'listings.visit.err.exists' as MessageKey;
  if (d.reason === 'visit_limit') return 'listings.visit.err.limit' as MessageKey;
  if (d.reason === 'too_late') return 'listings.visit.err.late' as MessageKey;
  if (d.reason === 'past') return 'listings.visit.err.date' as MessageKey;
  return null;
}

/** Bornes d'une offre : 10 % à 100 % du prix demandé (unités mineures). */
export const offerBounds = (askingMinor: number): { min: number; max: number } => ({ min: Math.ceil(askingMinor / 10), max: askingMinor });

/** Clé de message pour une erreur d'offre ou de réponse (raison lue dans `details.reason`). */
export function offerErrorKey(details: unknown): MessageKey | null {
  if (Array.isArray(details)) return details.some((x) => (x as { path?: unknown })?.path === 'amountMinor') ? ('listings.offer.err.amount' as MessageKey) : null;
  const r = ((details ?? {}) as { reason?: unknown }).reason;
  if (r === 'offer_exists') return 'listings.offer.err.exists' as MessageKey;
  if (r === 'offer_limit') return 'listings.offer.err.limit' as MessageKey;
  if (r === 'listing_inactive') return 'listings.offer.err.inactive' as MessageKey;
  if (r === 'not_your_turn' || r === 'bad_status') return 'listings.offer.err.turn' as MessageKey;
  return null;
}

export const MAX_COMPARE = 3;
/** Ajoute ou retire une annonce de la liste à comparer (3 au plus : la plus ancienne sort). */
export const toggleCompare = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-MAX_COMPARE));
