/** Logique pure des lots (dates AAAA-MM-JJ, comparaison lexicographique = chronologique). */

export interface BatchLike {
  id: string;
  batchCode: string;
  expiresOn: string | null;
  receivedOn: string;
  quantityRemaining: number;
}

/** Jours entre `today` et la péremption (négatif = périmé depuis), null sans date. */
export function daysToExpiry(expiresOn: string | null, today: string): number | null {
  if (!expiresOn) return null;
  return Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** FEFO : péremption croissante, sans date en dernier, puis le plus ancien reçu, puis le code. */
export function fefoCompare(a: BatchLike, b: BatchLike): number {
  if (a.expiresOn !== b.expiresOn) {
    if (a.expiresOn === null) return 1;
    if (b.expiresOn === null) return -1;
    return a.expiresOn < b.expiresOn ? -1 : 1;
  }
  if (a.receivedOn !== b.receivedOn) return a.receivedOn < b.receivedOn ? -1 : 1;
  return a.batchCode < b.batchCode ? -1 : a.batchCode > b.batchCode ? 1 : 0;
}

export const fefoOrder = <T extends BatchLike>(batches: T[]): T[] => batches.filter((b) => b.quantityRemaining > 0).sort(fefoCompare);

/** Répartition suggérée d'une quantité sur les lots non périmés, dans l'ordre FEFO. `shortfall` = reste non couvert. */
export function fefoPlan<T extends BatchLike>(batches: T[], quantity: number, today: string): { plan: { batchId: string; batchCode: string; take: number }[]; shortfall: number } {
  const plan: { batchId: string; batchCode: string; take: number }[] = [];
  let left = quantity;
  for (const b of fefoOrder(batches)) {
    if (left <= 0) break;
    if (b.expiresOn !== null && b.expiresOn < today) continue;
    const take = Math.min(left, b.quantityRemaining);
    plan.push({ batchId: b.id, batchCode: b.batchCode, take });
    left -= take;
  }
  return { plan, shortfall: left };
}
