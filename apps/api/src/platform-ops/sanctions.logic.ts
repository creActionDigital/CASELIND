import { LONG_SUSPENSION_DAYS, type SanctionKind } from '@caselind/contracts';

export type SanctionVerdict = { kind: 'direct' } | { kind: 'approval' } | { kind: 'refuse'; reason: 'self' | 'target_is_admin' | 'forbidden' };

const STAFF = ['moderator', 'support', 'admin'];

/**
 * Qui peut sanctionner qui (limites d'action, CDC §26).
 * - Jamais soi-même.
 * - Modérateur : avertissement et blocage de publication seulement, jamais un compte du personnel.
 * - Administrateur : tout, mais un autre administrateur seulement par double validation ; un bannissement ou une suspension
 *   de plus de 7 jours visant le personnel passe aussi par la double validation.
 * `approvalActive` : la double validation est en service ; sinon un administrateur cible est refusé et le reste s'exécute directement.
 */
export function sanctionVerdict(i: {
  actorId: string;
  actorRoles: readonly string[];
  targetId: string;
  targetRoles: readonly string[];
  kind: SanctionKind;
  durationDays?: number | undefined;
  approvalActive: boolean;
}): SanctionVerdict {
  if (i.actorId === i.targetId) return { kind: 'refuse', reason: 'self' };
  const targetAdmin = i.targetRoles.includes('admin');
  const targetStaff = i.targetRoles.some((r) => STAFF.includes(r));
  if (!i.actorRoles.includes('admin')) {
    if (!i.actorRoles.includes('moderator')) return { kind: 'refuse', reason: 'forbidden' };
    if ((i.kind !== 'warning' && i.kind !== 'mute_posting') || targetStaff) return { kind: 'refuse', reason: 'forbidden' };
    return { kind: 'direct' };
  }
  if (targetAdmin) return i.approvalActive ? { kind: 'approval' } : { kind: 'refuse', reason: 'target_is_admin' };
  const heavy = i.kind === 'ban' || (i.kind === 'suspension_temp' && (i.durationDays ?? 0) > LONG_SUSPENSION_DAYS);
  return targetStaff && heavy && i.approvalActive ? { kind: 'approval' } : { kind: 'direct' };
}

/** Un modérateur ne lève une sanction (ou ne tranche un recours) que pour un avertissement ou un blocage de publication. */
export const moderatorMayHandle = (kind: SanctionKind): boolean => kind === 'warning' || kind === 'mute_posting';
