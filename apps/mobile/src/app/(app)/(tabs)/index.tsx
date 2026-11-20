import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { useImpressionReporting } from '../../../creator/hooks';
import { dedupeById } from '../../../creator/logic';
import { mixFeed } from '../../../home/feed-mix';
import { HomeBanner, PromoCard, SectionHeader, VideoCard } from '../../../home/parts';
import { useI18n } from '../../../i18n';
import { fetchRecentProducts } from '../../../shop/api';
import { ProductCard } from '../../../shop/ProductGrid';
import { fetchFeed } from '../../../social/api';
import { sk } from '../../../social/keys';
import type { CachedPost } from '../../../social/logic';
import { PostCard } from '../../../social/PostCard';
import { StoriesBar } from '../../../stories/StoriesBar';
import { spacing, TAB_BAR_SPACE } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { EmptyState, ErrorState } from '../../../ui';

/** Sections « événements » et « promotions » : aucune source côté API pour l'instant, donc vides (rien ne s'affiche). */
interface Promo {
  id: string;
  title: string;
  body?: string;
}
const NO_PROMOS: Promo[] = [];

const SECTION_COUNT = 4;

/** Accueil : bandeau, statuts, produits récents, puis fil mélangé (publications, vidéos, produits, promotions). */
export default function Home() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const { me } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const feed = useInfiniteQuery({
    queryKey: sk.feed,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const products = useQuery({ queryKey: ['home-products', 6], queryFn: () => fetchRecentProducts(6), staleTime: 60_000 });
  // Une publication sponsorisée peut revenir sur la page suivante : une seule carte par id.
  const items = useMemo(() => dedupeById((feed.data?.pages.flatMap((p) => p.items) ?? []) as CachedPost[]), [feed.data]);
  const productItems = products.data?.items ?? [];
  const sectionProducts = productItems.slice(0, SECTION_COUNT);
  const mixed = useMemo(() => mixFeed(items, productItems.slice(SECTION_COUNT), NO_PROMOS, 4), [items, productItems]);

  const impressions = useImpressionReporting<(typeof mixed)[number]>((e) => (e.type === 'post' && !e.post.local && e.post.author.id !== me?.id ? e.post.id : null));

  let state: 'loading' | 'error' | 'empty' | 'list';
  if (feed.isPending) state = 'loading';
  else if (feed.isError && items.length === 0) state = 'error';
  else if (items.length === 0) state = 'empty';
  else state = 'list';

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={mixed}
        onViewableItemsChanged={impressions.onViewableItemsChanged}
        viewabilityConfig={impressions.viewabilityConfig}
        keyExtractor={(e) => e.key}
        renderItem={({ item }) => {
          if (item.type === 'product')
            return (
              <View style={styles.productRow}>
                <ProductCard product={item.product} width={220} />
              </View>
            );
          if (item.type === 'promo') return <PromoCard title={item.promo.title} body={item.promo.body} />;
          return item.post.kind === 'video' && !item.post.local ? <VideoCard post={item.post} /> : <PostCard post={item.post} />;
        }}
        ListHeaderComponent={
          <View>
            <HomeBanner name={me?.displayName ?? ''} />
            <StoriesBar />
            {sectionProducts.length > 0 ? (
              <View>
                <SectionHeader
                  title={t('home.products')}
                  actionLabel={t('home.seeMore')}
                  actionA11y={t('home.seeMoreA11y')}
                  onAction={() => router.push('/shop')}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productsScroll}>
                  {sectionProducts.map((p) => (
                    <ProductCard key={p.id} product={p} width={164} />
                  ))}
                </ScrollView>
              </View>
            ) : null}
            {state === 'loading' ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
            {state === 'error' ? <ErrorState error={feed.error} onRetry={() => feed.refetch()} /> : null}
            {state === 'empty' ? (
              <EmptyState
                icon="newspaper-outline"
                title={t('feed.emptyTitle')}
                body={t('feed.emptyBody')}
                actionLabel={t('feed.emptyAction')}
                onAction={() => router.push('/search')}
              />
            ) : null}
          </View>
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : <View style={{ height: TAB_BAR_SPACE }} />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([feed.refetch(), products.refetch()]);
              setRefreshing(false);
            }}
          />
        }
        onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: spacing.xl },
  productsScroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  productRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
