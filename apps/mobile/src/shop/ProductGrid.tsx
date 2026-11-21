import type { StorefrontProduct } from '@caselind/contracts';
import type { UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { brandAccent, onMedia, radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, EmptyState, ErrorState, Text } from '../ui';
import { PromoBadge, PromoPrice } from '../promotions/parts';
import { useToggleWishFromCard, useWishedIds } from '../promotions/hooks';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from './format';

/** Carte produit : image arrondie, pastille « Rupture » posée dessus (voile uni sombre), cœur « souhaits », nom puis prix. */
export const ProductCard = memo(function ProductCard({ product, width }: { product: StorefrontProduct; width?: number }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const price = formatMoney(product.minPriceMinor, product.currency, locale);
  const wished = useWishedIds().has(product.id);
  const wish = useToggleWishFromCard();
  return (
    // Le cœur est un frère de la carte cliquable (pas de bouton dans un bouton).
    <View style={{ width }}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('shop.productA11y', { title: product.title, price, shop: product.org.name })}
      onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: product.id } })}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.85 : 1 }]}
    >
      <View>
        <AuthImage contentUrl={product.coverUrl} label={product.title} style={styles.image} />
        <View style={styles.promo} pointerEvents="none">
          <PromoBadge priceMinor={product.minPriceMinor} compareAtMinor={product.compareAtPriceMinor} />
        </View>
        {product.inStock ? null : (
          <View style={styles.badge} importantForAccessibility="no-hide-descendants">
            <Text variant="caption" color={onMedia}>
              {t('shop.outOfStock')}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text variant="small" numberOfLines={2} style={styles.name}>
          {product.title}
        </Text>
        <PromoPrice priceMinor={product.minPriceMinor} compareAtMinor={product.compareAtPriceMinor} currency={product.currency} />
      </View>
    </Pressable>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(wished ? 'wish.remove' : 'wish.add')}
      accessibilityState={{ selected: wished }}
      hitSlop={6}
      onPress={() => wish.mutate({ productId: product.id, wish: !wished })}
      style={styles.heart}
    >
      <Ionicons name={wished ? 'heart' : 'heart-outline'} size={20} color={onMedia} />
    </Pressable>
    </View>
  );
});

interface Props {
  query: UseInfiniteQueryResult<InfiniteData<{ items: StorefrontProduct[]; nextCursor: string | null }>, Error>;
  header?: ReactElement;
  emptyTitle: string;
  emptyBody: string;
  /** Bloc affiché sous la grille (ex. questions fréquentes de la vitrine). */
  footer?: ReactElement;
  /** Sans produit : ni message ni grille (vitrine d'une organisation qui ne vend rien). */
  hideWhenEmpty?: boolean;
}

/** Grille 2 colonnes à défilement infini, avec les 5 états (chargement, erreur, vide, rafraîchissement, page suivante). */
export function ProductGrid({ query, header, emptyTitle, emptyBody, footer, hideWhenEmpty }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  let state: ReactElement | undefined;
  if (query.isPending) state = <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />;
  else if (query.isError && items.length === 0) state = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else if (items.length === 0 && !hideWhenEmpty) state = <EmptyState icon="bag-handle-outline" title={emptyTitle} body={emptyBody} />;

  return (
    <FlatList
      data={state ? [] : items}
      keyExtractor={(p) => p.id}
      numColumns={2}
      columnWrapperStyle={styles.columns}
      contentContainerStyle={styles.content}
      ListHeaderComponent={header}
      ListEmptyComponent={state}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.primary}
          onRefresh={async () => {
            setRefreshing(true);
            await query.refetch();
            setRefreshing(false);
          }}
        />
      }
      ListFooterComponent={
        <>
          {query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
          {footer}
        </>
      }
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
      onEndReachedThreshold={0.5}
      renderItem={({ item }) => (
        <View style={styles.cell}>
          <ProductCard product={item} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1, paddingBottom: spacing.xxl },
  columns: { gap: spacing.md },
  cell: { flex: 1, maxWidth: '50%' },
  card: { borderRadius: radius.xl, padding: spacing.sm, overflow: 'hidden' },
  image: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, backgroundColor: 'transparent' },
  badge: { position: 'absolute', top: spacing.sm, left: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.72)' },
  promo: { position: 'absolute', bottom: spacing.sm, left: spacing.sm },
  heart: { position: 'absolute', top: 0, right: 0, width: 40, height: 40, borderTopRightRadius: radius.xl, borderBottomLeftRadius: radius.lg, backgroundColor: brandAccent, alignItems: 'center', justifyContent: 'center' },
  info: { paddingHorizontal: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: 2 },
  name: { fontWeight: '500', minHeight: 40 },
});
