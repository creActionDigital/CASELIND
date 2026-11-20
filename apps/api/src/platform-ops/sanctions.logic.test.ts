import { describe, expect, it } from 'vitest';
import { moderatorMayHandle, sanctionVerdict } from './sanctions.logic.js';

const base = { actorId: 'a', targetId: 't', targetRoles: ['user'], kind: 'warning' as const, approvalActive: false };
const admin = { ...base, actorRoles: ['user', 'admin'] };
const mod = { ...base, actorRoles: ['user', 'moderator'] };

describe('sanctionVerdict', () => {
  it('jamais soi-même', () => {
    expect(sanctionVerdict({ ...admin, targetId: 'a' })).toEqual({ kind: 'refuse', reason: 'self' });
    expect(sanctionVerdict({ ...mod, targetId: 'a' })).toEqual({ kind: 'refuse', reason: 'self' });
  });
  it('modérateur : avertissement et blocage, pas de suspension, pas le personnel', () => {
    expect(sanctionVerdict(mod).kind).toBe('direct');
    expect(sanctionVerdict({ ...mod, kind: 'mute_posting', durationDays: 7 }).kind).toBe('direct');
    expect(sanctionVerdict({ ...mod, kind: 'suspension_temp', durationDays: 1 })).toEqual({ kind: 'refuse', reason: 'forbidden' });
    expect(sanctionVerdict({ ...mod, kind: 'ban' })).toEqual({ kind: 'refuse', reason: 'forbidden' });
    expect(sanctionVerdict({ ...mod, targetRoles: ['user', 'support'] })).toEqual({ kind: 'refuse', reason: 'forbidden' });
    expect(sanctionVerdict({ ...base, actorRoles: ['user'] })).toEqual({ kind: 'refuse', reason: 'forbidden' });
  });
  it('administrateur : un autre administrateur seulement par double validation', () => {
    expect(sanctionVerdict({ ...admin, targetRoles: ['admin'] })).toEqual({ kind: 'refuse', reason: 'target_is_admin' });
    expect(sanctionVerdict({ ...admin, targetRoles: ['admin'], approvalActive: true })).toEqual({ kind: 'approval' });
  });
  it('personnel : ban ou suspension de plus de 7 jours par double validation, le reste directement', () => {
    const staff = { ...admin, targetRoles: ['user', 'moderator'], approvalActive: true };
    expect(sanctionVerdict({ ...staff, kind: 'ban' })).toEqual({ kind: 'approval' });
    expect(sanctionVerdict({ ...staff, kind: 'suspension_temp', durationDays: 8 })).toEqual({ kind: 'approval' });
    expect(sanctionVerdict({ ...staff, kind: 'suspension_temp', durationDays: 7 }).kind).toBe('direct');
    expect(sanctionVerdict({ ...staff, kind: 'warning' }).kind).toBe('direct');
    expect(sanctionVerdict({ ...staff, kind: 'ban', approvalActive: false }).kind).toBe('direct');
    expect(sanctionVerdict({ ...admin, kind: 'ban', approvalActive: true }).kind).toBe('direct');
  });
  it('périmètre des modérateurs sur les levées et recours', () => {
    expect(moderatorMayHandle('warning')).toBe(true);
    expect(moderatorMayHandle('mute_posting')).toBe(true);
    expect(moderatorMayHandle('ban')).toBe(false);
    expect(moderatorMayHandle('suspension_temp')).toBe(false);
  });
});
