export type SellerTarget = { pathname: '/seller/[orgId]/orders/[orderId]'; params: { orgId: string; orderId: string } };

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * Destination d'une notification `commerce` côté vendeur : `data.orgId` n'est présent que pour une commande
 * reçue par une boutique (nouvelle commande, annulation par l'acheteur). Sans `orgId`, la notification
 * s'adresse à l'acheteur (route gérée par le parcours acheteur).
 */
export function sellerTarget(data: unknown): SellerTarget | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const orgId = str(d.orgId);
  const orderId = str(d.orderId);
  return orgId && orderId ? { pathname: '/seller/[orgId]/orders/[orderId]', params: { orgId, orderId } } : null;
}
