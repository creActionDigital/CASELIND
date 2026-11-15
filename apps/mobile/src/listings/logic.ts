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
