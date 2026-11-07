import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { CachedMessage, MessagePages } from './cache';
import { extrasKeys } from './extras-api';
import { nextExpiryDelay, removeExpired } from './extras-logic';
import { qk } from './keys';

/** Brouillon connu de cette conversation (cache alimenté par le salon et par `draft.updated`). */
export function useDraftText(conversationId: string): string | null {
  const q = useQuery<string | null>({
    queryKey: extrasKeys.draft(conversationId),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
  return q.data ?? null;
}

/**
 * Minuterie locale d'expiration : à l'échéance du prochain message éphémère, il quitte le cache,
 * puis la liste est rechargée (le serveur ne le sert plus).
 */
export function useExpiryTimer(conversationId: string, items: CachedMessage[]): void {
  const qc = useQueryClient();
  const expiries = items.map((m) => m.expiresAt ?? '').join('|');
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    const delay = nextExpiryDelay(itemsRef.current, Date.now());
    if (delay === null) return;
    const handle = setTimeout(() => {
      qc.setQueryData<MessagePages>(qk.messages(conversationId), (d) => removeExpired(d, Date.now()));
      void qc.invalidateQueries({ queryKey: qk.messages(conversationId) });
      void qc.invalidateQueries({ queryKey: qk.conversationsAll });
    }, delay);
    return () => clearTimeout(handle);
  }, [expiries, conversationId, qc]);
}
