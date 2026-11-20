import { useSyncExternalStore } from 'react';
import { toggleCompareProduct } from './compare-logic';

/** Produits choisis pour la comparaison : en mémoire seulement, perdus au redémarrage (comme les annonces). */
let ids: string[] = [];
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const useCompareProductIds = (): string[] => useSyncExternalStore(subscribe, () => ids);
/** Renvoie la nouvelle liste. */
export function toggleCompareProductId(id: string): string[] {
  ids = toggleCompareProduct(ids, id);
  listeners.forEach((l) => l());
  return ids;
}
export function clearCompareProducts(): void {
  ids = [];
  listeners.forEach((l) => l());
}
