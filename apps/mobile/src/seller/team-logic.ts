import { orgRoleSchema, type OrgRole } from '@caselind/contracts';

export const ROLES: readonly OrgRole[] = orgRoleSchema.options;
const ADMIN_LEVEL: readonly OrgRole[] = ['owner', 'admin'];

/**
 * Miroir d'affichage de `apps/api/src/orgs/org-permissions.ts` (le serveur reste la référence) :
 * permissions listées par rôle, pour la matrice « qui peut quoi ».
 */
export const TEAM_PERMISSIONS = ['team', 'catalog', 'orders', 'stock', 'finance', 'hr', 'support', 'delivery'] as const;
export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

const ALL = TEAM_PERMISSIONS;
export const ROLE_PERMISSIONS: Record<OrgRole, readonly TeamPermission[]> = {
  owner: ALL,
  admin: ALL,
  manager: ['team', 'catalog', 'orders', 'stock', 'support', 'delivery'],
  finance: ['finance', 'orders', 'hr'],
  stock: ['stock'],
  sales: ['catalog', 'orders'],
  hr: ['team', 'hr'],
  support: ['support', 'orders'],
  delivery: ['delivery'],
  employee: [],
};

/** Gérer l'équipe (inviter, changer un rôle, retirer) : propriétaire et administrateur. */
export const canManageTeam = (role: OrgRole | undefined): boolean => role === 'owner' || role === 'admin';
/** Voir l'équipe : ceux qui la gèrent, plus gestionnaire et RH. */
export const canViewTeam = (role: OrgRole | undefined): boolean => canManageTeam(role) || role === 'manager' || role === 'hr';

/** Rôles que l'acteur peut attribuer : seuls les propriétaires attribuent propriétaire ou administrateur. */
export function assignableRoles(actor: OrgRole | undefined): OrgRole[] {
  if (!canManageTeam(actor)) return [];
  return ROLES.filter((r) => actor === 'owner' || !ADMIN_LEVEL.includes(r));
}

/** L'acteur peut-il modifier ou retirer ce membre ? Un administrateur ne touche ni propriétaire ni administrateur. */
export function canEditMember(actor: OrgRole | undefined, target: OrgRole, isSelf: boolean): boolean {
  if (!canManageTeam(actor)) return false;
  if (isSelf) return false;
  return actor === 'owner' || !ADMIN_LEVEL.includes(target);
}
