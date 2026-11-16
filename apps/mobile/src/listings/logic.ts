import type { Listing, ListingKind } from '@caselind/contracts';
import type { MessageKey } from '../i18n';
import { formatMoney } from '../shop/format';

export const LISTING_KINDS: ListingKind[] = ['property_rent', 'property_sale', 'roommate', 'vehicle', 'used_item', 'lost', 'found'];

export const kindKey = (kind: ListingKind): MessageKey => `listings.kind.${kind}` as MessageKey;

/** Objets perdus ou trouvés : jamais de prix. */
export const hasPrice = (kind: ListingKind): boolean => kind !== 'lost' && kind !== 'found';

export function priceLabel(l: Pick<Listing, 'priceMinor' | 'currency'>, locale: string): string | null {
  return l.priceMinor === null || l.currency === null ? null : formatMoney(l.priceMinor, l.currency, locale);
}

/** "AAAA-MM-JJ" + "HH:MM" (UTC) vers une date ISO, ou null si invalide. */
export function parseVisitTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || !/^\d{2}:\d{2}$/.test(time.trim())) return null;
  const d = new Date(`${date.trim()}T${time.trim()}:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Clé de message pour une erreur 409/400 de demande ou d'annulation de visite (raison lue dans les détails de l'erreur). */
export function visitErrorKey(details: unknown): MessageKey | null {
  const s = JSON.stringify(details ?? '');
  if (s.includes('visit_exists')) return 'listings.visit.err.exists' as MessageKey;
  if (s.includes('visit_limit')) return 'listings.visit.err.limit' as MessageKey;
  if (s.includes('too_late')) return 'listings.visit.err.late' as MessageKey;
  if (s.includes('scheduledAt') || s.includes('past')) return 'listings.visit.err.date' as MessageKey;
  return null;
}
