import type { WishlistItem } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { fetchWishlist, promoKeys, removeWish } from '../../promotions/api';
import { PromoBadge, PromoPrice } from '../../promotions/parts';
import { fetchProduct } from '../../shop/api';
import { shopKeys, useCart, useSetCartItem } from '../../shop/hooks';
import { quantityOf } from '../../shop/cart-logic';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { AuthImage, Button, EmptyState, ErrorState, Text } from '../../ui';

type Data = InfiniteData<{ items: WishlistItem[]; nextCursor: string | null }>;

/** « Mes souhaits » : produits mis de côté, avec le prix effectif du moment ; un produit devenu indisponible reste listé. */
export default function Wishlist() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const cart = useCart();
  const setItem = useSetCartItem();
  const [notice, setNotice] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const query = useInfiniteQuery({
    queryKey: promoKeys.wishlist,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchWishlist(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const remove = useMutation({
    mutationFn: (productId: string) => removeWish(productId),
    onMutate: async (productId) => {
      await qc.cancelQueries({ queryKey: promoKeys.wishlist });
      const prev = qc.getQueryData<Data>(promoKeys.wishlist);
      qc.setQueryData<Data>(promoKeys.wishlist, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((i) => i.productId !== productId) })) });
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(promoKeys.wishlist, ctx.prev);
    },
    onSettled: (_d, _e, productId) => {
      void qc.invalidateQueries({ queryKey: promoKeys.wishlist });
      void qc.invalidateQueries({ queryKey: shopKeys.product(productId) });
    },
  });
  /** Une seule variante en stock : ajout direct ; sinon la fiche produit pour choisir. */
  const addToCart = useMutation({
    mutationFn: async (productId: string) => {
      const p = await fetchProduct(productId);
      const open = p.variants.filter((v) => v.inStock);
      if (open.length !== 1) return { choose: true as const };
      const v = open[0]!;
      await setItem.mutateAsync({ variantId: v.id, quantity: quantityOf(cart.data, v.id) + 1 });
      return { choose: false as const };
    },
    onSuccess: (r, productId) => {
      if (r.choose) router.push({ pathname: '/product/[productId]', params: { productId } });
      else setNotice({ id: productId, text: t('wish.addedToCart'), ok: true });
    },
    onError: (e, productId) => setNotice({ id: productId, text: errorMessage(e, t, locale), ok: false }),
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const header = <Stack.Screen options={{ title: t('wish.title') }} />;

  if (query.isPending) {
    return (
      <View style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        {header}
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (query.isError && items.length === 0) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {header}
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(i) => i.productId}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.4}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => query.refetch()}
        contentContainerStyle={items.length === 0 ? styles.grow : styles.list}
        ListEmptyComponent={<EmptyState icon="heart-outline" title={t('wish.emptyTitle')} body={t('wish.emptyBody')} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.pad} /> : undefined}
        renderItem={({ item }) => {
          const p = item.product;
          return (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={p ? p.title : t('wish.unavailable')}
                disabled={!p}
                onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: item.productId } })}
                style={styles.row}
              >
                {p ? <AuthImage contentUrl={p.coverUrl} label={p.title} style={styles.image} /> : <View style={[styles.image, { backgroundColor: colors.surfaceAlt }]} />}
                <View style={styles.flex}>
                  {p ? (
                    <>
                      <Text variant="bodyStrong" numberOfLines={2}>
                        {p.title}
                      </Text>
                      <Text variant="small" muted numberOfLines={1}>
                        {p.org.name}
                      </Text>
                      <PromoPrice priceMinor={p.minPriceMinor} compareAtMinor={p.compareAtPriceMinor} currency={p.currency} />
                      <PromoBadge priceMinor={p.minPriceMinor} compareAtMinor={p.compareAtPriceMinor} />
                      {p.inStock ? null : <Text variant="small" color={colors.danger}>{t('wish.outOfStock')}</Text>}
                    </>
                  ) : (
                    <Text muted>{t('wish.unavailable')}</Text>
                  )}
                </View>
              </Pressable>
              {notice?.id === item.productId ? (
                <Text variant="small" color={notice.ok ? colors.success : colors.danger} accessibilityLiveRegion="polite">
                  {notice.text}
                </Text>
              ) : null}
              <View style={styles.actions}>
                {p && p.inStock ? (
                  <Button
                    label={t('wish.addToCart')}
                    loading={addToCart.isPending && addToCart.variables === item.productId}
                    onPress={() => {
                      setNotice(null);
                      addToCart.mutate(item.productId);
                    }}
                  />
                ) : null}
                <Button variant="secondary" label={t('wish.removeAction')} onPress={() => remove.mutate(item.productId)} />
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  grow: { flexGrow: 1 },
  list: { padding: spacing.lg, gap: spacing.md },
  pad: { padding: spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  image: { width: 88, height: 88, borderRadius: radius.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
