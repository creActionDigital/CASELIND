import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { useImpressionReporting } from '../../../creator/hooks';
import { dedupeById } from '../../../creator/logic';
import { mixFeed } from '../../../home/feed-mix';
import { discoverKeys, fetchPeople } from '../../../home/discover-api';
import { PersonCard } from '../../../home/PersonCard';
import { setPrefs, usePrefs } from '../../../prefs/store';
import { PromoCard, SectionHeader, VideoCard } from '../../../home/parts';
import { useI18n } from '../../../i18n';
import { fetchRecentProducts } from '../../../shop/api';
import { ProductCard } from '../../../shop/ProductGrid';
import { fetchFeed } from '../../../social/api';
import { sk } from '../../../social/keys';
import type { CachedPost } from '../../../social/logic';
import { PostCard } from '../../../social/PostCard';
import { StoriesBar } from '../../../stories/StoriesBar';
import { radius, spacing, TAB_BAR_SPACE } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { EmptyState, ErrorState, Text } from '../../../ui';
import { SkeletonList } from '../../../ui/premium';
import type { MessageKey } from '../../../i18n';

type Scope = 'forYou' | 'following' | 'popular';
const TABS: { scope: Scope; label: MessageKey }[] = [
  { scope: 'forYou', label: 'ma.home.forYou' },
  { scope: 'following', label: 'ma.home.following' },
  { scope: 'popular', label: 'ma.home.popular' },
];

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
  const [scope, setScope] = useState<Scope>('forYou');
  const prefs = usePrefs();
  // Après une inscription : une seule proposition de compléter le profil (photo, nom d'utilisateur).
  useEffect(() => {
    if (prefs.loaded && prefs.profileSetupPending && me) {
      setPrefs({ profileSetupPending: false });
      router.push('/setup-profile' as never);
    }
  }, [prefs.loaded, prefs.profileSetupPending, me, router]);
  const people = useQuery({ queryKey: discoverKeys.people(8), queryFn: () => fetchPeople(8), enabled: scope !== 'following' });

  const feed = useInfiniteQuery({
    // « Abonnements » garde la clé historique (publication locale, mises à jour optimistes) ; les autres onglets en dérivent.
    queryKey: scope === 'following' ? sk.feed : [...sk.feed, scope],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFeed(pageParam, scope),
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
            {people.data && people.data.items.length > 0 ? (
              <View>
                <SectionHeader title={t('ma.discover.people')} actionLabel={t('home.seeMore')} actionA11y={t('home.seeMoreA11y')} onAction={() => router.push('/discover' as never)} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productsScroll}>
                  {people.data.items.map((p) => (
                    <PersonCard key={p.userId} person={p} width={150} />
                  ))}
                </ScrollView>
              </View>
            ) : null}
            <View style={styles.tabs} accessibilityRole="tablist">
              {TABS.map((x) => {
                const selected = scope === x.scope;
                return (
                  <Pressable
                    key={x.scope}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => setScope(x.scope)}
                    style={[styles.tab, { backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
                  >
                    <Text variant="small" color={selected ? colors.onPrimary : colors.text}>
                      {t(x.label)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {state === 'loading' ? <View style={styles.pad}><SkeletonList rows={3} label={t('common.loading')} /></View> : null}
            {state === 'error' ? <ErrorState error={feed.error} onRetry={() => feed.refetch()} /> : null}
            {state === 'empty' ? (
              <EmptyState
                icon="newspaper-outline"
                title={t('feed.emptyTitle')}
                body={t('feed.emptyBody')}
                actionLabel={t('ma.home.discover')}
                onAction={() => router.push('/discover' as never)}
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
              await Promise.all([feed.refetch(), products.refetch(), people.refetch()]);
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
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tab: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  productsScroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  productRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});
