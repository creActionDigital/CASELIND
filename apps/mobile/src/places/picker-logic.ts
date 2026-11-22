import type { RidePoint } from '@caselind/contracts';
import { roundCoordinate, type LatLng } from './geo';

export interface PickedPlace extends LatLng {
  label: string;
  address?: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const same = (a: LatLng, b: LatLng) => roundCoordinate(a.lat) === roundCoordinate(b.lat) && roundCoordinate(a.lng) === roundCoordinate(b.lng);

/** Lieux récents : le plus récent en tête, sans doublon de position, 5 au plus. */
export function addRecentPlace(list: readonly PickedPlace[], p: PickedPlace): PickedPlace[] {
  return [p, ...list.filter((x) => !same(x, p))].slice(0, 5);
}

export function parseRecentPlaces(raw: string | null): PickedPlace[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is PickedPlace => !!x && typeof x.lat === 'number' && typeof x.lng === 'number' && typeof x.label === 'string' && Math.abs(x.lat) <= 90 && Math.abs(x.lng) <= 180)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/** Filtre les lieux enregistrés/récents sur le texte tapé (nom ou adresse, sans accents ni casse). */
export function matchSaved<T extends { label: string; address?: string }>(items: readonly T[], q: string): T[] {
  const n = norm(q);
  return n ? items.filter((i) => norm(`${i.label} ${i.address ?? ''}`).includes(n)) : [...items];
}

/** Nom d'un point posé sur la carte : le lieu connu le plus proche (≤ 150 m), sinon `fallback`. */
export function labelForPoint(p: LatLng, known: readonly PickedPlace[], fallback: string): string {
  let best: PickedPlace | null = null;
  let bestD = 0.15;
  for (const k of known) {
    const d = haversineKm(p, k);
    if (d <= bestD) {
      best = k;
      bestD = d;
    }
  }
  return best?.label ?? fallback;
}

function haversineKm(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export const toRidePoint = (p: PickedPlace): RidePoint => ({ lat: roundCoordinate(p.lat), lng: roundCoordinate(p.lng), label: p.label.slice(0, 160) });
