import type { SearchResult, SearchScope } from '@caselind/contracts';

export const MIN_QUERY_LENGTH = 2;
export const DEBOUNCE_MS = 300;

export type SearchTab = SearchScope;
export const SEARCH_TABS: readonly SearchTab[] = ['all', 'users', 'orgs', 'products', 'posts'];

/** Requête exploitable (≥ 2 caractères une fois rognée) ou null. */
export function effectiveQuery(raw: string): string | null {
  const q = raw.trim();
  return q.length >= MIN_QUERY_LENGTH ? q : null;
}

export interface Debouncer<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/** Anti-rebond : seul le dernier appel d'une rafale s'exécute, `ms` après celui-ci. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debouncer<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  }) as Debouncer<A>;
  wrapped.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

/**
 * File de requêtes « la dernière gagne » : une réponse qui arrive après une requête plus récente est
 * signalée `stale`, pour qu'une réponse lente n'écrase pas la saisie courante.
 */
export function createLatestQueue() {
  let seq = 0;
  return {
    async run<T>(task: () => Promise<T>): Promise<{ stale: boolean; value?: T }> {
      const mine = ++seq;
      const value = await task();
      return mine === seq ? { stale: false, value } : { stale: true };
    },
  };
}

export type Category = 'users' | 'orgs' | 'products' | 'posts';
export const CATEGORIES: readonly Category[] = ['users', 'orgs', 'products', 'posts'];

export interface CategoryGroup {
  category: Category;
  count: number;
  /** Il y a davantage de résultats : afficher « Voir plus ». */
  more: boolean;
}

/** Catégories non vides d'un résultat `scope=all`, dans l'ordre d'affichage, avec l'indicateur « voir plus ». */
export function groupResults(result: SearchResult | undefined): CategoryGroup[] {
  if (!result) return [];
  const out: CategoryGroup[] = [];
  for (const category of CATEGORIES) {
    const page = result[category];
    if (page && page.items.length > 0) out.push({ category, count: page.items.length, more: page.nextCursor !== null });
  }
  return out;
}
