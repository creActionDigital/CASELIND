/** Géographie pure (sans dépendance native) : ville pilote, distances, rayon, liens d'itinéraire, saisie de coordonnées. */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Ville pilote : centre-ville de Goma (point de départ par défaut des lieux). */
export const GOMA_CENTER: LatLng = { lat: -1.6585, lng: 29.2205 };

export const RADII_KM = [1, 5, 10, 25] as const;
export type RadiusKm = (typeof RADII_KM)[number];
export const DEFAULT_RADIUS_KM: RadiusKm = 10;

/** « 850 m », « 1,2 km », « 12 km » selon la langue. */
export function formatDistance(km: number, locale = 'fr'): string {
  const d = Number.isFinite(km) && km > 0 ? km : 0;
  if (d < 1) {
    const m = Math.max(10, Math.round((d * 1000) / 10) * 10);
    return m >= 1000 ? formatDistance(1, locale) : `${m} m`;
  }
  const digits = d < 10 ? 1 : 0;
  const n = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(d);
  return `${n} km`;
}

export type MapsPlatform = 'android' | 'ios' | 'web';

/** Lien qui ouvre l'application de cartes du système vers une destination. */
export function directionsUrl(platform: MapsPlatform, dest: LatLng & { label?: string | null }): string {
  const { lat, lng } = dest;
  const label = dest.label?.trim();
  if (platform === 'android') {
    return `geo:${lat},${lng}?q=${lat},${lng}${label ? `(${encodeURIComponent(label)})` : ''}`;
  }
  if (platform === 'ios') {
    return `maps:?daddr=${lat},${lng}${label ? `&q=${encodeURIComponent(label)}` : ''}`;
  }
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** Saisie « -1,6585 » ou « -1.6585 » ; null si hors plage ou invalide. */
export function parseCoordinate(input: string, kind: 'lat' | 'lng'): number | null {
  const s = input.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  const max = kind === 'lat' ? 90 : 180;
  return Math.abs(n) <= max ? n : null;
}

/** Arrondi à 4 décimales (~11 m) : suffisant pour un emplacement de boutique. */
export const roundCoordinate = (n: number): number => Math.round(n * 1e4) / 1e4;
