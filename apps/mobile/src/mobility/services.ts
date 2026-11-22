import type { MessageKey } from '../i18n';

export interface TransportService {
  id: string;
  key: MessageKey;
  hint: MessageKey;
  icon: 'car-outline' | 'people-outline' | 'key-outline' | 'build-outline' | 'cube-outline' | 'document-text-outline' | 'restaurant-outline' | 'cart-outline';
  href: string;
}

/** Les services du transport : chacun mène à un écran existant (la course, le covoiturage, la location, le dépannage, le coursier). */
export const TRANSPORT_SERVICES: readonly TransportService[] = [
  { id: 'ride', key: 'mb.transport.ride', hint: 'mb.transport.ride.hint', icon: 'car-outline', href: '/rides' },
  { id: 'carpool', key: 'mb.transport.carpool', hint: 'mb.transport.carpool.hint', icon: 'people-outline', href: '/carpool' },
  { id: 'rental', key: 'mb.transport.rental', hint: 'mb.transport.rental.hint', icon: 'key-outline', href: '/rentals' },
  { id: 'roadside', key: 'mb.transport.roadside', hint: 'mb.transport.roadside.hint', icon: 'build-outline', href: '/roadside' },
  { id: 'parcel', key: 'mb.transport.parcel', hint: 'mb.transport.parcel.hint', icon: 'cube-outline', href: '/courier?kind=parcel' },
  { id: 'courier', key: 'mb.transport.courier', hint: 'mb.transport.courier.hint', icon: 'document-text-outline', href: '/courier?kind=document' },
  { id: 'meal', key: 'mb.transport.meal', hint: 'mb.transport.meal.hint', icon: 'restaurant-outline', href: '/courier?kind=meal' },
  { id: 'groceries', key: 'mb.transport.groceries', hint: 'mb.transport.groceries.hint', icon: 'cart-outline', href: '/courier?kind=groceries' },
];

/** Raccourcis d'espaces (historique, livraisons, chauffeur, livreur). */
export const TRANSPORT_SPACES: readonly { key: MessageKey; href: string }[] = [
  { key: 'mobility.link.places', href: '/rides/places' },
  { key: 'mb.transport.history', href: '/rides/history' },
  { key: 'mb.transport.deliveries', href: '/deliveries' },
  { key: 'mb.transport.driver', href: '/rides/driver' },
  { key: 'mb.transport.courierSpace', href: '/courier/available' },
];

/** Chemin d'un lien (sans requête), pour vérifier qu'il existe parmi les écrans. */
export const hrefPath = (href: string): string => href.split('?')[0]!;
