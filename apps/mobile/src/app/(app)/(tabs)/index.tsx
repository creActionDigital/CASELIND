import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchFeed } from '../../../social/api';
import { sk } from '../../../social/keys';
import type { CachedPost } from '../../../social/logic';
import { PostCard } from '../../../social/PostCard';
import { StoriesBar } from '../../../stories/StoriesBar';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { EmptyState, ErrorState } from '../../../ui';

/** Accueil : barre de stories en haut, puis le fil des publications (défilement infini, tirer pour rafraîchir). */
export default function Home() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const feed = useInfiniteQuery({
    queryKey: sk.feed,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (feed.data?.pages.flatMap((p) => p.items) ?? []) as CachedPost[];

  let state: 'loading' | 'error' | 'empty' | 'list';
  if (feed.isPending) state = 'loading';
  else if (feed.isError && items.length === 0) state = 'error';
  else if (items.length === 0) state = 'empty';
  else state = 'list';

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PostCard post={item} />}
        ListHeaderComponent={
          <View>
            <StoriesBar />
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
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={async () => {
              setRefreshing(true);
              await feed.refetch();
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
});
