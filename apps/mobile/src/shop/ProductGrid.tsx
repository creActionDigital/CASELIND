import type { StorefrontProduct } from '@caselind/contracts';
import type { UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, EmptyState, ErrorState, Text } from '../ui';
import { formatMoney } from './format';

export const ProductCard = memo(function ProductCard({ product }: { product: StorefrontProduct }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const price = formatMoney(product.minPriceMinor, product.currency, locale);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('shop.productA11y', { title: product.title, price, shop: product.org.name })}
      onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: product.id } })}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <AuthImage contentUrl={product.coverUrl} label={product.title} style={styles.image} />
      <View style={styles.info}>
        <Text variant="small" numberOfLines={2} style={{ fontWeight: '600', minHeight: 40 }}>
          {product.title}
        </Text>
        <Text variant="bodyStrong" color={colors.primary}>
          {t('shop.from', { price })}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {product.inStock ? product.org.name : `${t('shop.outOfStock')} · ${product.org.name}`}
        </Text>
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
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  columns: { gap: spacing.md },
  cell: { flex: 1, maxWidth: '50%' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  image: { width: '100%', aspectRatio: 1, borderRadius: 0 },
  info: { padding: spacing.md, gap: spacing.xs },
});
