import type { OrgRole } from '@caselind/contracts';

/**
 * Every permission an org role can carry. Lot 2a only enforces the org.* ones; the business
 * permissions (catalog, orders, inventory...) are declared now so later lots plug into the same
 * map instead of inventing per-module role checks.
 */
export const ORG_PERMISSIONS = [
  'org.view',
  'org.profile.edit',
  'org.members.view',
  'org.members.manage',
  'org.admins.manage',
  'org.delete',
  'catalog.manage',
  'orders.view',
  'orders.manage',
  'inventory.manage',
  'finance.view',
  /** Écriture des dépenses (gestion d'entreprise) : droit séparé de la lecture des chiffres. */
  'finance.manage',
  'hr.manage',
  /** Registre de salaire (etat saisi a la main) : finance et RH uniquement. */
  'payroll.manage',
  'support.inbox',
  'delivery.tasks',
] as const;
export type OrgPermissionKey = (typeof ORG_PERMISSIONS)[number];

/** Roles that only holders of `org.admins.manage` (owners) may grant, change or remove. */
export const ADMIN_LEVEL_ROLES: readonly OrgRole[] = ['owner', 'admin'];

const ALL = ORG_PERMISSIONS;

/**
 * Role → permissions. Server-side source of truth (CDC §4: permissions enforced by the server,
 * not only hidden in the UI). Every role has `org.view` (read the org it belongs to).
 *
 * - owner: everything, including managing admins/owners and deleting the org.
 * - admin: runs the org day to day but cannot touch owners/admins nor delete the org.
 * - manager: operations (catalog, orders, stock, support, delivery) and sees the team.
 * - specialised roles: their own area only.
 */
export const ORG_ROLE_PERMISSIONS: Readonly<Record<OrgRole, ReadonlySet<OrgPermissionKey>>> = {
  owner: new Set(ALL),
  admin: new Set(ALL.filter((p) => p !== 'org.admins.manage' && p !== 'org.delete')),
  manager: new Set([
    'org.view',
    'org.members.view',
    'catalog.manage',
    'orders.view',
    'orders.manage',
    'inventory.manage',
    'support.inbox',
    'delivery.tasks',
  ]),
  finance: new Set(['org.view', 'finance.view', 'finance.manage', 'payroll.manage', 'orders.view']),
  stock: new Set(['org.view', 'inventory.manage']),
  sales: new Set(['org.view', 'catalog.manage', 'orders.view', 'orders.manage']),
  hr: new Set(['org.view', 'org.members.view', 'hr.manage', 'payroll.manage']),
  support: new Set(['org.view', 'support.inbox', 'orders.view']),
  delivery: new Set(['org.view', 'delivery.tasks']),
  employee: new Set(['org.view']),
};

export function roleHasPermission(role: OrgRole, permission: OrgPermissionKey): boolean {
  return ORG_ROLE_PERMISSIONS[role].has(permission);
}
