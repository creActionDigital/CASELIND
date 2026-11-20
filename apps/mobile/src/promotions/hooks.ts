import type { StorefrontProductDetail } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { shopKeys } from '../shop/hooks';
import { addWish, promoKeys, removeWish } from './api';

/** Heure courante rafraîchie chaque seconde (compte à rebours) ; à ne monter que si une promotion est affichée. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Cœur « souhaits » de la fiche produit : bascule optimiste sur `wished`, retour en arrière si le serveur refuse. */
export function useToggleWish(productId: string) {
  const qc = useQueryClient();
  const key = shopKeys.product(productId);
  return useMutation({
    mutationFn: (wish: boolean) => (wish ? addWish(productId) : removeWish(productId)),
    onMutate: async (wish) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<StorefrontProductDetail>(key);
      if (prev) qc.setQueryData<StorefrontProductDetail>(key, { ...prev, wished: wish });
      return { prev };
    },
    onError: (_e, _wish, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: promoKeys.wishlist }),
  });
}
