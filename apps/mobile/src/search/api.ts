import { searchHistorySchema, searchResultSchema, type SearchScope } from '@caselind/contracts';
import { useEffect, useState } from 'react';
import { api } from '../auth/auth-context';
import { DEBOUNCE_MS } from './logic';

export const searchKeys = {
  results: (q: string, scope: SearchScope) => ['search', q, scope] as const,
  history: ['search-history'] as const,
};

export const fetchSearch = (q: string, scope: SearchScope, cursor?: string) =>
  api.request('/search', { query: { q, scope, cursor, limit: scope === 'all' ? undefined : 20 }, schema: searchResultSchema });

export const fetchHistory = () => api.request('/me/search-history', { schema: searchHistorySchema });
export const deleteHistoryEntry = (id: string) => api.request(`/me/search-history/${id}`, { method: 'DELETE' });
export const clearHistory = () => api.request('/me/search-history', { method: 'DELETE' });
export const setHistoryEnabled = (enabled: boolean) =>
  api.request('/me/search-history/settings', { method: 'PATCH', body: { enabled } });

/** Valeur qui ne suit la saisie qu'après `ms` de calme (300 ms par défaut). */
export function useDebouncedValue<T>(value: T, ms = DEBOUNCE_MS): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
