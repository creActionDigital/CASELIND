import { orgRoleSchema } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { assignableRoles, canEditMember, canManageTeam, canViewTeam, ROLE_PERMISSIONS } from './team-logic';

describe('équipe et rôles (droits)', () => {
  it('chaque rôle du contrat a une entrée de permissions', () => {
    for (const r of orgRoleSchema.options) expect(ROLE_PERMISSIONS[r]).toBeDefined();
  });
  it('seuls propriétaire et administrateur gèrent ; gestionnaire et RH voient', () => {
    expect(canManageTeam('owner') && canManageTeam('admin')).toBe(true);
    expect(canManageTeam('manager') || canManageTeam('finance') || canManageTeam(undefined)).toBe(false);
    expect(canViewTeam('manager') && canViewTeam('hr')).toBe(true);
    expect(canViewTeam('employee')).toBe(false);
  });
  it('un administrateur ne peut pas attribuer propriétaire ou administrateur', () => {
    expect(assignableRoles('admin')).not.toContain('owner');
    expect(assignableRoles('admin')).not.toContain('admin');
    expect(assignableRoles('owner')).toContain('owner');
    expect(assignableRoles('sales')).toEqual([]);
  });
  it('on ne se modifie pas soi-même et un administrateur ne touche pas un propriétaire', () => {
    expect(canEditMember('owner', 'employee', true)).toBe(false);
    expect(canEditMember('admin', 'owner', false)).toBe(false);
    expect(canEditMember('admin', 'sales', false)).toBe(true);
    expect(canEditMember('owner', 'admin', false)).toBe(true);
  });
});
