import type { DeliveryStatus, OrgMember } from '@caselind/contracts';

/** Affectation et réaffectation possibles jusqu'au retrait de la commande (ensuite 409 `invalid_transition`). */
export const canAssignCourier = (status: DeliveryStatus): boolean => status === 'pending' || status === 'assigned';

export interface CourierCandidate {
  userId: string;
  displayName: string;
  self: boolean;
}

/** Livreurs proposables : membres actifs au rôle `delivery`, plus l'appelant lui-même (toujours accepté par le serveur). */
export function courierCandidates(members: readonly OrgMember[], me: { id: string; displayName: string } | null): CourierCandidate[] {
  const list: CourierCandidate[] = members
    .filter((m) => m.status === 'active' && m.role === 'delivery' && m.userId !== me?.id)
    .map((m) => ({ userId: m.userId, displayName: m.displayName, self: false }));
  if (me) list.unshift({ userId: me.id, displayName: me.displayName, self: true });
  return list;
}

/** Entrée « Mes livraisons » : membre actif d'une organisation avec le rôle `delivery`. */
export function isCourier(memberships: readonly { role: string; status: string }[] | undefined): boolean {
  return !!memberships?.some((m) => m.status === 'active' && m.role === 'delivery');
}
