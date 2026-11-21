import type { OrgKind } from '@caselind/contracts';

/**
 * Modules du tableau de bord pro par secteur : `core` en tête (le coeur du métier), le reste ensuite.
 * Les chemins sont ceux de `seller/[orgId]/*`. Le rôle masque ensuite ce qui n'est pas permis.
 */
const CORE: Record<OrgKind, readonly string[]> = {
  shop: ['/products', '/stock', '/orders', '/pos', '/coupons', '/promotions', '/zones'],
  restaurant: ['/products', '/orders', '/pos', '/zones', '/qr', '/purchasing'],
  hotel: ['/rentals', '/services', '/documents', '/customers', '/qr'],
  pharmacy: ['/products', '/stock', '/batches', '/inventory', '/pos'],
  fuel_station: ['/pos', '/stock', '/inventory', '/qr', '/purchasing'],
  school: ['/school', '/hr', '/documents', '/customers', '/qr'],
  hospital: ['/services', '/hr', '/documents', '/stock', '/inventory'],
  services: ['/services', '/documents', '/customers', '/jobs', '/qr'],
  warehouse: ['/stock', '/inventory', '/batches', '/purchasing', '/orders'],
  other: ['/products', '/orders', '/documents', '/customers'],
};

export function sectorCore(kind: OrgKind): readonly string[] {
  return CORE[kind];
}

/** Sépare les raccourcis visibles en « essentiel du secteur » (ordre du secteur) et « autres » (ordre d'origine). */
export function splitBySector<T extends { path: string }>(kind: OrgKind, shortcuts: readonly T[]): { core: T[]; others: T[] } {
  const order = CORE[kind];
  const core = shortcuts.filter((s) => order.includes(s.path)).sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
  const others = shortcuts.filter((s) => !order.includes(s.path));
  return { core, others };
}

