import {
  type CreateReturnRequest,
  type OrderItem,
  type OrderReturn,
  RETURN_TRANSITIONS,
  type ReturnActorKind,
  type ReturnReason,
  type ReturnStatus,
} from '@caselind/contracts';

const DAY_MS = 86_400_000;

export type WindowInfo = { state: 'none' } | { state: 'open'; daysLeft: number } | { state: 'closed' };

/** Fenêtre de demande (fournie par le serveur : livraison + 7 jours) : jours restants, arrondis au jour entamé. */
export function windowInfo(windowEndsAt: string | null, now: number = Date.now()): WindowInfo {
  if (!windowEndsAt) return { state: 'none' };
  const left = Date.parse(windowEndsAt) - now;
  return left > 0 ? { state: 'open', daysLeft: Math.ceil(left / DAY_MS) } : { state: 'closed' };
}

export type ReturnAction = 'cancel' | 'dispute' | 'approve' | 'reject' | 'received' | 'refunded' | 'resolve';

const ACTION_OF: Record<ReturnActorKind, Partial<Record<ReturnStatus, ReturnAction>>> = {
  buyer: { cancelled: 'cancel', disputed: 'dispute' },
  org: { approved: 'approve', rejected: 'reject', received: 'received', refunded: 'refunded' },
  admin: { resolved: 'resolve' },
};

/** Actions proposables à `kind` sur ce retour (miroir de la machine d'états du serveur, qui reste la référence). */
export function availableActions(kind: ReturnActorKind, r: Pick<OrderReturn, 'status' | 'resolution'>): ReturnAction[] {
  const next = RETURN_TRANSITIONS[kind][r.status] ?? [];
  return next
    // Une décision de la plateforme contre l'acheteur ne laisse rien à rembourser.
    .filter((to) => !(kind === 'org' && r.status === 'resolved' && r.resolution === 'reject' && to === 'refunded'))
    .map((to) => ACTION_OF[kind][to])
    .filter((a): a is ReturnAction => a !== undefined);
}

/** Un retour sans suite possible pour personne (affichage « clos »). */
export const isClosed = (s: ReturnStatus): boolean => s === 'refunded' || s === 'cancelled';

export const RETURN_REASONS: readonly ReturnReason[] = ['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'other'];

export const clampQty = (n: number, max: number): number => Math.max(0, Math.min(max, Math.trunc(Number.isFinite(n) ? n : 0)));

/** Quantités saisies (par ligne de commande) → demande ; `none` sans ligne, `quantity` au-delà de la commande. */
export function buildReturnRequest(
  reason: ReturnReason,
  details: string,
  quantities: Readonly<Record<string, number>>,
  items: readonly Pick<OrderItem, 'id' | 'quantity'>[],
): { ok: CreateReturnRequest } | { error: 'none' | 'quantity' } {
  const lines: CreateReturnRequest['items'] = [];
  for (const i of items) {
    const q = quantities[i.id] ?? 0;
    if (q > i.quantity) return { error: 'quantity' };
    if (q > 0) lines.push({ orderItemId: i.id, quantity: q });
  }
  if (lines.length === 0) return { error: 'none' };
  const d = details.trim();
  return { ok: { reason, ...(d ? { details: d } : {}), items: lines } };
}

/** Message de l'erreur 409 propre aux retours, sinon null (le texte générique prend le relais). */
export function returnReasonKey(reason: unknown): 'not_delivered' | 'window_closed' | 'return_exists' | 'invalid_transition' | null {
  return reason === 'not_delivered' || reason === 'window_closed' || reason === 'return_exists' || reason === 'invalid_transition' ? reason : null;
}
