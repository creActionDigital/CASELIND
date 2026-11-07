import type { OrderStatus, OrgRole } from '@caselind/contracts';
import { can } from './permissions';

/** Transitions vendeur (miroir de SELLER_TRANSITIONS côté API) ; le serveur reste la référence. */
export const SELLER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Statuts suivants proposables : aucun sans `orders.manage`. */
export function allowedNext(status: OrderStatus, role: OrgRole | undefined): OrderStatus[] {
  return can(role, 'orders.manage') ? [...SELLER_TRANSITIONS[status]] : [];
}

/** Les annulations demandent confirmation (et une note facultative). */
export const needsConfirmation = (to: OrderStatus): boolean => to === 'cancelled';

export const FLOW: readonly OrderStatus[] = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered'];

/** Tri « nouvelles en tête » : les en attente d'abord, puis les plus récentes. */
export function sortNewestFirst<T extends { status: OrderStatus; createdAt: string }>(orders: readonly T[]): T[] {
  return [...orders].sort((a, b) => {
    const pa = a.status === 'pending' ? 1 : 0;
    const pb = b.status === 'pending' ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}
