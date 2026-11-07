import type { OrgRole } from '@caselind/contracts';

/**
 * Miroir en lecture seule de `apps/api/src/orgs/org-permissions.ts`, uniquement pour masquer ce que le rôle
 * ne permet pas. Le serveur reste la référence (un 403 est toujours possible).
 */
export type SellerPermission = 'catalog.manage' | 'orders.view' | 'orders.manage' | 'inventory.manage';

const ALL: SellerPermission[] = ['catalog.manage', 'orders.view', 'orders.manage', 'inventory.manage'];

const BY_ROLE: Record<OrgRole, readonly SellerPermission[]> = {
  owner: ALL,
  admin: ALL,
  manager: ALL,
  finance: ['orders.view'],
  stock: ['inventory.manage'],
  sales: ['catalog.manage', 'orders.view', 'orders.manage'],
  hr: [],
  support: ['orders.view'],
  delivery: [],
  employee: [],
};

export function can(role: OrgRole | undefined, permission: SellerPermission): boolean {
  return !!role && BY_ROLE[role].includes(permission);
}

/** Le stock se règle avec `inventory.manage` ou `catalog.manage` (règle de la route). */
export function canAdjustStock(role: OrgRole | undefined): boolean {
  return can(role, 'inventory.manage') || can(role, 'catalog.manage');
}

/** Lecture des produits et variantes (stock exact) : `catalog.manage` ou `inventory.manage` ; l'écriture reste `catalog.manage`. */
export function canReadCatalog(role: OrgRole | undefined): boolean {
  return can(role, 'catalog.manage') || can(role, 'inventory.manage');
}

/** Avis de la boutique : `orders.view` ou `catalog.manage`. */
export function canViewReviews(role: OrgRole | undefined): boolean {
  return can(role, 'orders.view') || can(role, 'catalog.manage');
}

/** L'espace vendeur n'a d'intérêt que si le rôle donne accès à au moins un module. */
export function hasSellerAccess(role: OrgRole | undefined): boolean {
  return can(role, 'catalog.manage') || can(role, 'orders.view') || can(role, 'inventory.manage');
}

/** Emplacement de la boutique : permission `org.profile.edit` (propriétaire et administrateur). */
export function canEditProfile(role: OrgRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}
