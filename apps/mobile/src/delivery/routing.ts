export type DeliveryTarget = { pathname: '/deliveries/[deliveryId]'; params: { deliveryId: string; orderId?: string } };

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * Destination d'une notification de livraison (`data.deliveryId`). Les notifications aux gestionnaires portent `orgId` :
 * elles relèvent de l'espace vendeur. Pour un acheteur, l'écran livreur répond 404 et le renvoie vers sa commande (`orderId`).
 */
export function deliveryTarget(data: unknown): DeliveryTarget | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (d.orgId) return null;
  const deliveryId = str(d.deliveryId);
  if (!deliveryId) return null;
  const orderId = str(d.orderId);
  return { pathname: '/deliveries/[deliveryId]', params: orderId ? { deliveryId, orderId } : { deliveryId } };
}
