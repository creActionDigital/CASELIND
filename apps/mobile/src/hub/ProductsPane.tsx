import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { fetchProducts } from '../shop/api';
import { formatMoney } from '../shop/format';
import { brandAccent, glass, onMedia, radius, TAB_BAR_SPACE, TOUCH } from '../theme/tokens';
import { AuthImage, EmptyState, ErrorState, Text } from '../ui';

/** Vitrine sociale : un produit par page plein écran, bouton « Acheter » vers la fiche. */
export function ProductsPane({ height }: { height: number }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const q = useInfiniteQuery({
    queryKey: ['hub-products'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchProducts({ sort: 'recent' }, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  if (q.isPending) return <ActivityIndicator style={styles.state} color={onMedia} accessibilityLabel={t('common.loading')} />;
  if (q.isError && items.length === 0) {
    return (
      <View style={styles.state}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={styles.state}>
        <EmptyState icon="pricetag-outline" title={t('hub.products.empty')} body={t('hub.products.emptyBody')} />
      </View>
    );
  }
  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      pagingEnabled
      snapToInterval={height}
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      getItemLayout={(_d, i) => ({ length: height, offset: height * i, index: i })}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      onEndReachedThreshold={1}
      windowSize={3}
      renderItem={({ item }) => {
        const price = formatMoney(item.minPriceMinor, item.currency, locale);
        const open = () => router.push({ pathname: '/product/[productId]', params: { productId: item.id } });
        return (
          <View style={[styles.page, { height }]}>
            <View style={StyleSheet.absoluteFill}>
              {item.coverUrl ? (
                <AuthImage contentUrl={item.coverUrl} label={item.title} style={StyleSheet.absoluteFill} />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.state]}>
                  <Ionicons name="image-outline" size={56} color="rgba(255,255,255,0.3)" />
                </View>
              )}
            </View>
            <View style={[styles.info, { paddingBottom: TAB_BAR_SPACE - 8 }]}>
              <Text variant="caption" color="#D4D4DC" numberOfLines={1}>
                {item.org.name}
              </Text>
              <Text variant="heading" color={onMedia} numberOfLines={2}>
                {item.title}
              </Text>
              <View style={styles.row}>
                <Text variant="title" color={onMedia}>
                  {price}
                </Text>
                {!item.inStock ? (
                  <View style={styles.out}>
                    <Text variant="caption" color={onMedia}>
                      {t('hub.outOfStock')}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.row}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('hub.buy')} ${item.title}`} onPress={open} style={styles.buy}>
                  <Ionicons name="bag-handle-outline" size={20} color={onMedia} />
                  <Text variant="bodyStrong" color={onMedia}>
                    {t('hub.buy')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#14141B', justifyContent: 'flex-end' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  info: { paddingHorizontal: 16, paddingTop: 16, gap: 6, backgroundColor: 'rgba(0,0,0,0.55)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: TOUCH + 4,
    paddingHorizontal: 28,
    marginTop: 4,
    borderRadius: radius.pill,
    backgroundColor: brandAccent,
  },
  out: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: glass.dark },
});
