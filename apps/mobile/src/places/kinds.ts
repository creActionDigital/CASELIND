import type { OrgKind } from '@caselind/contracts';
import type { MessageKey } from '../i18n';

export interface PlaceAction {
  key: MessageKey;
  icon: 'storefront-outline' | 'calendar-outline' | 'school-outline' | 'medkit-outline' | 'construct-outline' | 'bed-outline';
  href: string;
}

/** Actions propres à chaque type de lieu, vers des écrans qui existent déjà (la fiche ne les réinvente pas). */
export function placeActions(kind: OrgKind, slug: string): PlaceAction[] {
  const store = (key: MessageKey): PlaceAction => ({ key, icon: 'storefront-outline', href: `/store/${slug}` });
  switch (kind) {
    case 'restaurant':
      return [store('mb.place.act.menu')];
    case 'shop':
    case 'pharmacy':
      return [store('mb.place.act.catalog')];
    case 'hotel':
      return [store('mb.place.act.rooms'), { key: 'mb.place.act.myBookings', icon: 'bed-outline', href: '/bookings' }];
    case 'hospital':
      return [{ key: 'mb.place.act.appointment', icon: 'medkit-outline', href: '/health/professionals' }];
    case 'school':
      return [{ key: 'mb.place.act.school', icon: 'school-outline', href: '/school/search' }];
    case 'services':
      return [{ key: 'mb.place.act.services', icon: 'construct-outline', href: '/services' }];
    default:
      return [];
  }
}

/** Texte de repère affiché sous le nom : types qui ont des horaires utiles en priorité (pharmacie, santé, restaurant). */
export const showsHoursFirst = (kind: OrgKind): boolean => kind === 'pharmacy' || kind === 'hospital' || kind === 'restaurant' || kind === 'fuel_station';

/** Nom d'organisation -> adresse de la fiche, avec la position transmise par la carte quand elle existe. */
export function placeHref(p: { slug: string; lat?: number; lng?: number; label?: string | null }): { pathname: '/place/[slug]'; params: Record<string, string> } {
  const params: Record<string, string> = { slug: p.slug };
  if (p.lat !== undefined && p.lng !== undefined) {
    params.lat = String(p.lat);
    params.lng = String(p.lng);
  }
  if (p.label) params.label = p.label;
  return { pathname: '/place/[slug]', params };
}
