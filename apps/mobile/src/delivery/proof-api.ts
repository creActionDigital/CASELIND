import { deliveryProofSchema, type DeliveryProof } from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, useAuth } from '../auth/auth-context';

export const proofKeys = { one: (deliveryId: string) => ['delivery', 'proof', deliveryId] as const };

export const fetchProof = (deliveryId: string) => api.request(`/deliveries/${deliveryId}/proof`, { schema: deliveryProofSchema });
export const setProof = (deliveryId: string, body: { photoAssetId?: string | null; signatureAssetId?: string | null }) =>
  api.request(`/deliveries/${deliveryId}/proof`, { method: 'PUT', body, schema: deliveryProofSchema });

/** Preuve lue par l'acheteur, le vendeur ou le livreur ; une erreur (404, flag absent) n'affiche simplement rien. */
export function useDeliveryProof(deliveryId: string, enabled: boolean) {
  const { status } = useAuth();
  return useQuery<DeliveryProof>({ queryKey: proofKeys.one(deliveryId), queryFn: () => fetchProof(deliveryId), enabled: enabled && status === 'signedIn', retry: false });
}
