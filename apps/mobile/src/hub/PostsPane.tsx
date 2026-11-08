import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { fetchFeed } from '../social/api';
import { sk } from '../social/keys';
import type { CachedPost } from '../social/logic';
import { PostCard } from '../social/PostCard';
import { onMedia, radius, TAB_BAR_SPACE } from '../theme/tokens';
import { EmptyState, ErrorState } from '../ui';

/** Fil des publications : les cartes de `PostCard` posées sur le fond immersif, avec des angles arrondis. */
export function PostsPane() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const feed = useInfiniteQuery({
    queryKey: sk.feed,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (feed.data?.pages.flatMap((p) => p.items) ?? []) as CachedPost[];
  return (
    <FlatList
      style={styles.flex}
      data={items}
      keyExtractor={(p) => p.id}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <PostCard post={item} />
        </View>
      )}
      contentContainerStyle={{ paddingTop: insets.top + 80, paddingBottom: TAB_BAR_SPACE, gap: 12 }}
      ListHeaderComponent={
        feed.isPending ? (
          <ActivityIndicator color={onMedia} accessibilityLabel={t('common.loading')} />
        ) : feed.isError && items.length === 0 ? (
          <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon="newspaper-outline" title={t('feed.emptyTitle')} body={t('feed.emptyBody')} actionLabel={t('feed.emptyAction')} onAction={() => router.push('/search')} />
        ) : undefined
      }
      ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={onMedia} accessibilityLabel={t('common.loading')} /> : undefined}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={onMedia}
          progressViewOffset={insets.top + 70}
          onRefresh={async () => {
            setRefreshing(true);
            await feed.refetch();
            setRefreshing(false);
          }}
        />
      }
      onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
      onEndReachedThreshold={0.6}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginHorizontal: 12, borderRadius: radius.xl, overflow: 'hidden' },
});
