import type { Contract, Milestone } from '@caselind/contracts';
import { ApiRequestError } from '../lib/api';
import type { MessageKey } from '../i18n';

export const contractStatusKey = (s: Contract['status']): MessageKey => `freelance.contract.${s}` as MessageKey;
export const milestoneStatusKey = (s: Milestone['status']): MessageKey => `freelance.milestone.${s}` as MessageKey;
export const proposalStatusKey = (s: 'proposed' | 'accepted' | 'rejected' | 'withdrawn'): MessageKey => `freelance.proposal.${s}` as MessageKey;

/** Actions proposées sur un jalon selon le rôle et l'état ; le serveur reste la référence. */
export type MilestoneAction = 'deliver' | 'approve' | 'revision';
export function milestoneActions(role: Contract['role'], contractStatus: Contract['status'], m: Pick<Milestone, 'status'>): MilestoneAction[] {
  if (contractStatus !== 'active') return [];
  if (role === 'freelancer') return m.status === 'pending' || m.status === 'revision' ? ['deliver'] : [];
  return m.status === 'delivered' ? ['approve', 'revision'] : [];
}

/** Annulation possible tant qu'aucun jalon n'est approuvé ; ensuite, litige. */
export const canCancel = (c: Pick<Contract, 'status' | 'milestones'>): boolean => c.status === 'active' && !c.milestones.some((m) => m.status === 'approved');
export const canDispute = (c: Pick<Contract, 'status'>): boolean => c.status === 'active';
export const canReview = (c: Pick<Contract, 'status' | 'myReview'>): boolean => c.status === 'completed' && !c.myReview;

/** Clé de message d'une raison de refus 409 connue, sinon null. */
export function freelanceErrorKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiRequestError)) return null;
  const reason = err.detail<string>('reason');
  const map: Record<string, MessageKey> = {
    mission_limit: 'freelance.err.mission_limit',
    already_proposed: 'freelance.err.already_proposed',
    mission_not_open: 'freelance.err.mission_not_open',
    contract_not_active: 'freelance.err.contract_not_active',
    invalid_transition: 'freelance.err.invalid_transition',
    has_approved_milestones: 'freelance.err.has_approved',
    already_reviewed: 'freelance.err.already_reviewed',
    proposal_not_open: 'freelance.err.proposal_not_open',
  };
  return reason && map[reason] ? map[reason]! : null;
}
