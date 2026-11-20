import type { Batch, InventoryCountDetail, PutCountLinesRequest } from '@caselind/contracts';
import { isDate } from '../hr/logic';

/** Logique pure des lots, de la péremption et de l'inventaire physique. */

export type BatchTone = 'expired' | 'soon' | 'ok' | 'none';

/** État de péremption d'un lot : périmé, dans les 7 jours, plus tard, ou sans date. */
export function batchTone(b: Pick<Batch, 'expired' | 'daysToExpiry' | 'quantityRemaining'>): BatchTone {
  if (b.daysToExpiry === null) return 'none';
  if (b.expired) return 'expired';
  return b.daysToExpiry <= 7 ? 'soon' : 'ok';
}

export interface BatchForm {
  batchCode: string;
  expiresOn: string;
  quantity: string;
  enterStock: boolean;
  note: string;
}
export type BatchFormError = 'code' | 'expiresOn' | 'quantity';

/** Entier strictement positif (jusqu'à 1 000 000) ; null sinon. */
export function parsePositive(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 1_000_000 ? n : null;
}

/** Entier de 0 à 1 000 000 (quantité comptée) ; null sinon. */
export function parseCounted(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n <= 1_000_000 ? n : null;
}

export function buildBatch(f: BatchForm) {
  const code = f.batchCode.trim();
  if (code.length < 1 || code.length > 40) return { error: 'code' as BatchFormError };
  const exp = f.expiresOn.trim();
  if (exp !== '' && !isDate(exp)) return { error: 'expiresOn' as BatchFormError };
  const quantity = parsePositive(f.quantity);
  if (quantity === null) return { error: 'quantity' as BatchFormError };
  const note = f.note.trim();
  return { ok: { batchCode: code, quantity, enterStock: f.enterStock, ...(exp ? { expiresOn: exp } : {}), ...(note ? { note } : {}) } };
}

/** Variance signée pour l'affichage : « +3 », « -1 », « 0 ». */
export const varianceLabel = (v: number): string => (v > 0 ? `+${v}` : String(v));

/**
 * Lignes à envoyer : seules les quantités saisies (non vides) et différentes de celles déjà enregistrées.
 * `error` = la première variante dont la saisie est invalide.
 */
export function changedLines(draft: Record<string, string>, saved: InventoryCountDetail['lines']): { ok: PutCountLinesRequest['lines'] } | { error: string } {
  const known = new Map(saved.map((l) => [l.variantId, l.countedQuantity]));
  const lines: PutCountLinesRequest['lines'] = [];
  for (const [variantId, raw] of Object.entries(draft)) {
    if (raw.trim() === '') continue;
    const n = parseCounted(raw);
    if (n === null) return { error: variantId };
    if (known.get(variantId) !== n) lines.push({ variantId, countedQuantity: n });
  }
  return { ok: lines };
}

/** Valeur initiale du champ « compté » d'une variante : la quantité déjà enregistrée, sinon vide. */
export const draftOf = (count: InventoryCountDetail | undefined): Record<string, string> =>
  Object.fromEntries((count?.lines ?? []).map((l) => [l.variantId, String(l.countedQuantity)]));
