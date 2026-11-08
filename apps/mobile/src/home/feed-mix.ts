/** Mélange du fil d'Accueil : publications, avec un produit ou une promotion intercalés tous les `every` éléments. */
export type MixEntry<P, S, M> =
  | { type: 'post'; key: string; post: P }
  | { type: 'product'; key: string; product: S }
  | { type: 'promo'; key: string; promo: M };

export function mixFeed<P extends { id: string }, S extends { id: string }, M extends { id: string }>(
  posts: P[],
  products: S[],
  promos: M[] = [],
  every = 4,
): MixEntry<P, S, M>[] {
  const out: MixEntry<P, S, M>[] = [];
  let pi = 0;
  let mi = 0;
  let slot = 0;
  posts.forEach((post, i) => {
    out.push({ type: 'post', key: `p-${post.id}`, post });
    if ((i + 1) % every === 0) {
      // Une promotion et un produit en alternance ; sans promotion, uniquement des produits.
      const wantPromo = slot % 2 === 1 && mi < promos.length;
      if (wantPromo) out.push({ type: 'promo', key: `m-${promos[mi].id}`, promo: promos[mi++] });
      else if (pi < products.length) out.push({ type: 'product', key: `s-${products[pi].id}`, product: products[pi++] });
      slot++;
    }
  });
  return out;
}
