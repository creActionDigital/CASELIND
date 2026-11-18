import type { LatLng } from './geo';

/** Carte à tuiles sans dépendance native : projection Web Mercator (tuiles de 256 px, comme OpenStreetMap). */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 18;
/** Adresse des tuiles. Le serveur public d'OpenStreetMap est réservé à un usage léger : en production, un fournisseur de tuiles (EXPO_PUBLIC_TILE_URL). */
export const TILE_URL = process.env.EXPO_PUBLIC_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const MAX_LAT = 85.0511;

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z)));
const worldSize = (zoom: number): number => TILE_SIZE * 2 ** zoom;

/** Position d'un point en pixels « monde » au zoom donné. */
export function project(p: LatLng, zoom: number): { x: number; y: number } {
  const size = worldSize(zoom);
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((p.lng + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size };
}

export function unproject(x: number, y: number, zoom: number): LatLng {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / size) * 360 - 180 };
}

export interface Tile {
  key: string;
  url: string;
  left: number;
  top: number;
}

/** Tuiles qui couvrent une fenêtre w×h centrée sur `center` ; l'axe est-ouest boucle autour du monde. */
export function visibleTiles(center: LatLng, zoom: number, w: number, h: number, template = TILE_URL): Tile[] {
  const c = project(center, zoom);
  const left = c.x - w / 2;
  const top = c.y - h / 2;
  const n = 2 ** zoom;
  const out: Tile[] = [];
  for (let ty = Math.floor(top / TILE_SIZE); ty <= Math.floor((top + h) / TILE_SIZE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE_SIZE); tx <= Math.floor((left + w) / TILE_SIZE); tx++) {
      const wrapped = ((tx % n) + n) % n;
      out.push({
        key: `${zoom}/${tx}/${ty}`,
        url: template.replace('{z}', String(zoom)).replace('{x}', String(wrapped)).replace('{y}', String(ty)),
        left: tx * TILE_SIZE - left,
        top: ty * TILE_SIZE - top,
      });
    }
  }
  return out;
}

/** Position à l'écran (px) d'un point dans la fenêtre w×h. */
export function toScreen(p: LatLng, center: LatLng, zoom: number, w: number, h: number): { x: number; y: number } {
  const c = project(center, zoom);
  const q = project(p, zoom);
  return { x: q.x - c.x + w / 2, y: q.y - c.y + h / 2 };
}

/** Déplace le centre de (dx, dy) pixels d'écran (le doigt tire la carte : le centre va dans l'autre sens). */
export function panCenter(center: LatLng, zoom: number, dx: number, dy: number): LatLng {
  const c = project(center, zoom);
  return unproject(c.x - dx, c.y - dy, zoom);
}

/** Centre et zoom qui montrent tous les points dans w×h avec une marge ; un seul point : zoom de rue. */
export function fitPoints(points: readonly LatLng[], w: number, h: number, pad = 48): { center: LatLng; zoom: number } {
  if (points.length === 0 || w <= 0 || h <= 0) return { center: { lat: 0, lng: 0 }, zoom: MIN_ZOOM };
  if (points.length === 1) return { center: points[0]!, zoom: 15 };
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom--) {
    const ps = points.map((p) => project(p, zoom));
    const minX = Math.min(...ps.map((p) => p.x));
    const maxX = Math.max(...ps.map((p) => p.x));
    const minY = Math.min(...ps.map((p) => p.y));
    const maxY = Math.max(...ps.map((p) => p.y));
    if (maxX - minX <= w - 2 * pad && maxY - minY <= h - 2 * pad) {
      return { center: unproject((minX + maxX) / 2, (minY + maxY) / 2, zoom), zoom };
    }
  }
  return { center: points[0]!, zoom: MIN_ZOOM };
}

/** Les quatre points cardinaux à `km` du centre (pour cadrer un rayon de recherche). */
export function radiusPoints(center: LatLng, km: number): LatLng[] {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  return [
    { lat: center.lat + dLat, lng: center.lng },
    { lat: center.lat - dLat, lng: center.lng },
    { lat: center.lat, lng: center.lng + dLng },
    { lat: center.lat, lng: center.lng - dLng },
  ];
}
