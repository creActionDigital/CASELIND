export type WalletTarget =
  | { pathname: '/wallet'; params?: { tx: string } }
  | { pathname: '/seller/[orgId]/wallet'; params: { orgId: string } };

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * Destination d'une notification `payment` : portefeuille de l'organisation si `orgId` (paiement marchand reçu),
 * sinon le Wallet, qui ouvre la fiche de la transaction quand `transferId` est connu.
 */
export function walletTarget(data: unknown): WalletTarget {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const orgId = str(d.orgId);
  if (orgId) return { pathname: '/seller/[orgId]/wallet', params: { orgId } };
  const tx = str(d.transferId);
  return tx ? { pathname: '/wallet', params: { tx } } : { pathname: '/wallet' };
}
