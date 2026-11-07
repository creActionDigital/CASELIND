import type { Cart, CartGroup } from '@caselind/contracts';

/** Total des sous-totaux, par devise (une commande par boutique et par devise ; jamais de somme entre devises). */
export function totalsByCurrency(groups: CartGroup[]): { currency: string; totalMinor: number }[] {
  const map = new Map<string, number>();
  for (const g of groups) map.set(g.currency, (map.get(g.currency) ?? 0) + g.subtotalMinor);
  return [...map].map(([currency, totalMinor]) => ({ currency, totalMinor }));
}

export const countItems = (groups: CartGroup[]): number => groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + l.quantity, 0), 0);

/** Nouvelle quantité d'une ligne (0 la retire) avec sous-totaux et compteur recalculés ; ligne inconnue : inchangé. */
export function withLineQuantity(cart: Cart, variantId: string, quantity: number): Cart {
  const groups = cart.groups
    .map((g) => {
      const lines = g.lines
        .map((l) => (l.variantId === variantId ? { ...l, quantity, lineTotalMinor: l.unitPriceMinor * quantity } : l))
        .filter((l) => l.quantity > 0);
      return { ...g, lines, subtotalMinor: lines.reduce((s, l) => s + l.lineTotalMinor, 0) };
    })
    .filter((g) => g.lines.length > 0);
  return { ...cart, groups, itemCount: countItems(groups) + cart.unavailable.reduce((n, u) => n + u.quantity, 0) };
}

export const quantityOf = (cart: Cart | undefined, variantId: string): number =>
  cart?.groups.flatMap((g) => g.lines).find((l) => l.variantId === variantId)?.quantity ?? 0;

/** On ne peut commander que sans ligne indisponible et avec au moins un article. */
export const canCheckout = (cart: Cart): boolean => cart.groups.length > 0 && cart.unavailable.length === 0;
