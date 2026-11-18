import type { DeliveryProof, DeliveryStatus, MediaMime } from '@caselind/contracts';

const ATTACHABLE: readonly DeliveryStatus[] = ['picked_up', 'in_transit', 'delivered'];
const PROOF_MIMES: readonly MediaMime[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Le livreur peut joindre ou retirer une preuve dès que la commande est récupérée, et encore une fois remise. */
export const canAttachProof = (status: DeliveryStatus): boolean => ATTACHABLE.includes(status);

/** La finalité `delivery_proof` n'accepte ni GIF ni vidéo : refus local avant l'envoi. */
export const isProofMime = (mime: MediaMime): boolean => PROOF_MIMES.includes(mime);

export const hasProof = (p: DeliveryProof | null | undefined): boolean => !!p && (p.photo !== null || p.signature !== null);

/** Une preuve se lit à partir du moment où le colis est en route ; avant, il n'y a rien à montrer. */
export const showsProof = (status: DeliveryStatus): boolean => canAttachProof(status);
