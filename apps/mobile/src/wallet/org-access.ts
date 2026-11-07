import type { OrgRole } from '@caselind/contracts';

/** Miroir de `finance.view` (apps/api/src/orgs/org-permissions.ts) : propriétaire, administrateur, finance. Le serveur reste la référence. */
export function canViewFinance(role: OrgRole | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'finance';
}
