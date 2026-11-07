import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { fetchCart, setCartItem } from './api';
import { withLineQuantity } from './cart-logic';
import type { Cart } from '@caselind/contracts';

export const shopKeys = {
  categories: ['shop-categories'] as const,
  products: (filters: unknown) => ['shop-products', filters] as const,
  product: (id: string) => ['shop-product', id] as const,
  reviews: (productId: string) => ['shop-reviews', productId] as const,
  store: (slug: string) => ['shop-store', slug] as const,
  storeProducts: (slug: string) => ['shop-store-products', slug] as const,
  cart: ['cart'] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['order', id] as const,
};

/** Panier partagé (écran Panier, fiche produit, badge de l'en-tête). Sans le flag `commerce`, l'erreur laisse le badge à 0. */
export function useCart() {
  const { status } = useAuth();
  return useQuery({ queryKey: shopKeys.cart, queryFn: fetchCart, enabled: status === 'signedIn', retry: false });
}

export function useCartCount(): number {
  return useCart().data?.itemCount ?? 0;
}

/** Quantité d'une ligne (0 retire), optimiste, puis remplacée par le panier du serveur. */
export function useSetCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { variantId: string; quantity: number }) => setCartItem(v.variantId, v.quantity),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: shopKeys.cart });
      const prev = qc.getQueryData<Cart>(shopKeys.cart);
      if (prev) qc.setQueryData<Cart>(shopKeys.cart, withLineQuantity(prev, v.variantId, v.quantity));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(shopKeys.cart, ctx.prev);
    },
    onSuccess: (server) => qc.setQueryData(shopKeys.cart, server),
  });
}
