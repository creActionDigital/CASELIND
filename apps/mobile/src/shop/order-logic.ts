import type { OrderStatus } from '@caselind/contracts';

export const canCancel = (status: OrderStatus): boolean => status === 'pending';
export const canReview = (status: OrderStatus): boolean => status === 'delivered';

/** Téléphone saisi → E.164 (`+` suivi de 7 à 15 chiffres) ; null si invalide. */
export function normalizePhone(input: string): string | null {
  const s = input.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

/** `/v1/media/{id}/content` pour un asset référencé par id (lignes de panier et de commande). */
export const mediaContentUrl = (assetId: string | null): string | null => (assetId ? `/v1/media/${assetId}/content` : null);

/** Destination d'une notification `commerce` : la commande si son `data` en porte l'identifiant. */
export function commerceTarget(data: unknown): { pathname: '/orders/[orderId]'; params: { orderId: string } } | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  // Les notifications adressées au vendeur portent `orgId` : elles relèvent de l'espace vendeur, pas des commandes d'acheteur.
  if (d.orgId) return null;
  const id = d.orderId;
  return typeof id === 'string' && id ? { pathname: '/orders/[orderId]', params: { orderId: id } } : null;
}

/** Frais de livraison à l'écran de paiement : « pending » tant qu'une zone doit encore être choisie, « free » seulement si le calcul le dit. */
export function feeKind(p: { delivery: boolean; zoneCount: number; zoneChosen: boolean; feeMinor: number }): 'pending' | 'free' | 'amount' {
  if (p.delivery && p.zoneCount > 0 && !p.zoneChosen) return 'pending';
  return p.feeMinor > 0 ? 'amount' : 'free';
}
