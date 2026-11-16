export const MIN_REASON = 3;
export const MAX_REASON = 500;

/** Motif valide : 3 à 500 caractères une fois les espaces retirés (comme le contrat de l'API). */
export function isValidReason(s: string): boolean {
  const n = s.trim().length;
  return n >= MIN_REASON && n <= MAX_REASON;
}

export type GovAction = 'suspend' | 'reactivate' | 'verify' | 'unverify';

/** Actions proposées selon le statut ; un compte ni actif ni suspendu n'en a aucune. */
export function userActions(status: string): GovAction[] {
  return status === 'active' ? ['suspend'] : status === 'suspended' ? ['reactivate'] : [];
}

export function orgActions(status: string, verification: string): GovAction[] {
  const out: GovAction[] = status === 'active' ? ['suspend'] : status === 'suspended' ? ['reactivate'] : [];
  out.push(verification === 'verified' ? 'unverify' : 'verify');
  return out;
}

