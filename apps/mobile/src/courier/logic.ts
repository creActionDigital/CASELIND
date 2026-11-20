import type { CourierRequest, CourierRequestStatus } from '@caselind/contracts';

/* Coursier à la demande : logique pure (le serveur reste la référence). */

export type CourierRole = 'requester' | 'courier';
export type CourierAction = 'cancel' | 'pickedUp' | 'delivered' | 'rate' | 'shareLocation' | 'resetCode';

const LIVE: readonly CourierRequestStatus[] = ['requested', 'accepted', 'picked_up'];
export const isLiveCourier = (s: CourierRequestStatus): boolean => LIVE.includes(s);

/** Actions possibles selon le statut et le rôle (miroir du serveur). */
export function courierActions(status: CourierRequestStatus, role: CourierRole, rated: boolean): CourierAction[] {
  if (role === 'requester') {
    if (status === 'requested' || status === 'accepted') return ['cancel'];
    if (status === 'picked_up') return ['resetCode'];
    return status === 'delivered' && !rated ? ['rate'] : [];
  }
  if (status === 'accepted') return ['pickedUp', 'shareLocation'];
  if (status === 'picked_up') return ['delivered', 'shareLocation'];
  return status === 'delivered' && !rated ? ['rate'] : [];
}

export const COURIER_STEPS: readonly CourierRequestStatus[] = ['requested', 'accepted', 'picked_up', 'delivered'];

/** Code de remise : 6 chiffres. */
export const isCompleteCourierCode = (code: string): boolean => /^\d{6}$/.test(code);

/** « 482 913 ». */
export const formatCourierCode = (code: string): string => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code);

/** Un colis a une taille, un document aucune. */
export const needsSize = (kind: 'parcel' | 'document'): boolean => kind === 'parcel';

/** Demande prête à estimer ou envoyer : les deux points, et la taille d'un colis. */
export function isRequestReady(d: { kind: 'parcel' | 'document'; size: string | null; pickup: unknown; dropoff: unknown }): boolean {
  return !!d.pickup && !!d.dropoff && (!needsSize(d.kind) || !!d.size);
}

/** Éléments à planifier : demandes acceptées ou en cours de remise, puis livraisons de commande (20 au plus, comme le serveur). */
export function planIds(jobs: readonly Pick<CourierRequest, 'id' | 'status'>[], deliveryIds: readonly string[] = []): string[] {
  return [...jobs.filter((j) => j.status === 'accepted' || j.status === 'picked_up').map((j) => j.id), ...deliveryIds].slice(0, 20);
}
