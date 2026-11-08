import type { StorefrontProduct } from '@caselind/contracts';
import type { UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { onMedia, radius, shadow, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, EmptyState, ErrorState, Text } from '../ui';
import { formatMoney } from './format';

/** Carte produit : image arrondie, pastille « Rupture » posée dessus (voile uni sombre), nom puis prix. */
export const ProductCard = memo(function ProductCard({ product, width }: { product: StorefrontProduct; width?: number }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const price = formatMoney(product.minPriceMinor, product.currency, locale);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('shop.productA11y', { title: product.title, price, shop: product.org.name })}
      onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: product.id } })}
      style={({ pressed }) => [styles.card, shadow.card, { width, backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View>
        <AuthImage contentUrl={product.coverUrl} label={product.title} style={styles.image} />
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
        <Text variant="bodyStrong">{price}</Text>
      </View>
    </Pressable>
  );
});

interface Props {
  query: UseInfiniteQueryResult<InfiniteData<{ items: StorefrontProduct[]; nextCursor: string | null }>, Error>;
  header?: ReactElement;
  emptyTitle: string;
  emptyBody: string;
}

/** Grille 2 colonnes à défilement infini, avec les 5 états (chargement, erreur, vide, rafraîchissement, page suivante). */
export function ProductGrid({ query, header, emptyTitle, emptyBody }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  let state: ReactElement | undefined;
  if (query.isPending) state = <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />;
  else if (query.isError && items.length === 0) state = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else if (items.length === 0) state = <EmptyState icon="bag-handle-outline" title={emptyTitle} body={emptyBody} />;

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
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : undefined}
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
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: spacing.sm },
  image: { width: '100%', aspectRatio: 1, borderRadius: radius.lg },
  badge: { position: 'absolute', top: spacing.sm, left: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.72)' },
  info: { paddingHorizontal: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: 2 },
  name: { fontWeight: '600', minHeight: 40 },
});
