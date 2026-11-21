import type { StorefrontProductDetail } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { shopKeys } from '../shop/hooks';
import { addWish, fetchWishlist, promoKeys, removeWish } from './api';

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

/** Ensemble des produits de la liste de souhaits (200 au plus : 2 pages de 100), pour les cœurs des cartes produit. */
export function useWishedIds(): Set<string> {
  const q = useQuery({
    queryKey: [...promoKeys.wishlist, 'ids'],
    staleTime: 60_000,
    queryFn: async () => {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 2; i++) {
        const page = await fetchWishlist(cursor, 100);
        ids.push(...page.items.map((w) => w.productId));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return ids;
    },
  });
  return new Set(q.data ?? []);
}

/** Cœur d'une carte produit : bascule optimiste de l'ensemble ci-dessus, annulée si le serveur refuse (liste pleine...). */
export function useToggleWishFromCard() {
  const qc = useQueryClient();
  const key = [...promoKeys.wishlist, 'ids'];
  return useMutation({
    mutationFn: ({ productId, wish }: { productId: string; wish: boolean }) => (wish ? addWish(productId) : removeWish(productId)),
    onMutate: async ({ productId, wish }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<string[]>(key);
      qc.setQueryData<string[]>(key, (ids = []) => (wish ? [...ids, productId] : ids.filter((id) => id !== productId)));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.prev),
    onSettled: (_d, _e, { productId }) => {
      void qc.invalidateQueries({ queryKey: promoKeys.wishlist });
      void qc.invalidateQueries({ queryKey: shopKeys.product(productId) });
    },
  });
}
