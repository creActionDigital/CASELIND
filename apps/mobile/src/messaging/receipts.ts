import type { ReceiptEvent } from '@caselind/contracts';

/** Position d'un autre membre. `read` est null quand il a désactivé les accusés de lecture. */
export interface ReceiptPosition {
  delivered: number;
  read: number | null;
}
export type ReceiptMap = Record<string, ReceiptPosition>;

export type MessageStatus = 'sending' | 'failed' | 'sent' | 'delivered' | 'read';

/**
 * État d'accusé d'un message que j'ai envoyé, d'après la position des autres membres :
 * lu si tous l'ont lu (valeur connue), reçu si tous l'ont reçu (ou lu), sinon envoyé.
 */
export function receiptStatus(
  message: { seq: number; local?: 'sending' | 'failed' },
  others: ReceiptPosition[],
): MessageStatus {
  if (message.local) return message.local;
  if (others.length === 0) return 'sent';
  if (others.every((o) => o.read !== null && o.read >= message.seq)) return 'read';
  if (others.every((o) => Math.max(o.delivered, o.read ?? 0) >= message.seq)) return 'delivered';
  return 'sent';
}

/** Fusionne un `receipt.updated` (monotone : on ne recule jamais). */
export function mergeReceipt(map: ReceiptMap | undefined, ev: ReceiptEvent): ReceiptMap {
  const prev = map?.[ev.userId];
  const read = ev.lastReadSeq === null ? (prev?.read ?? null) : Math.max(prev?.read ?? 0, ev.lastReadSeq);
  return {
    ...map,
    [ev.userId]: { delivered: Math.max(prev?.delivered ?? 0, ev.lastDeliveredSeq), read },
  };
}

/** Initialise depuis la liste des membres (seule `lastReadSeq` est connue). */
export function receiptsFromMembers(members: { userId: string; lastReadSeq: number | null }[], myId: string): ReceiptMap {
  const map: ReceiptMap = {};
  for (const m of members) {
    if (m.userId === myId) continue;
    map[m.userId] = { delivered: m.lastReadSeq ?? 0, read: m.lastReadSeq };
  }
  return map;
}
