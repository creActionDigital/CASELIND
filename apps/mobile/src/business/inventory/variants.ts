import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchProducts, sk } from '../../seller/api';

export interface VariantRow {
  variantId: string;
  sku: string;
  label: string;
  title: string;
  stock: number;
  trackStock: boolean;
}

/** Variantes des produits non archivés de l'organisation, page par page (même source que l'écran « Stock »). */
export function useVariantRows(orgId: string, enabled: boolean) {
  const q = useInfiniteQuery({
    queryKey: [...sk.products(orgId), 'variant-rows'],
    queryFn: ({ pageParam }) => fetchProducts(orgId, undefined, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!orgId && enabled,
  });
  const rows: VariantRow[] = (q.data?.pages ?? [])
    .flatMap((p) => p.items)
    .filter((p) => p.status !== 'archived')
    .flatMap((p) =>
      p.variants.map((v) => ({ variantId: v.id, sku: v.sku, label: Object.values(v.options).join(' / '), title: p.title, stock: v.stock, trackStock: v.trackStock })),
    );
  return { q, rows };
}
