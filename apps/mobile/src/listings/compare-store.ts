import { useSyncExternalStore } from 'react';
import { toggleCompare } from './logic';

/** Liste locale (mémoire, perdue au redémarrage) des annonces à comparer. */
let ids: string[] = [];
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const useCompareIds = (): string[] => useSyncExternalStore(subscribe, () => ids);
export function toggleCompareId(id: string): void {
  ids = toggleCompare(ids, id);
  listeners.forEach((l) => l());
}
