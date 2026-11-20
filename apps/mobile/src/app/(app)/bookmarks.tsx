import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { fetchBookmarks } from '../../creator/api';
import { useI18n } from '../../i18n';
import type { CachedPost } from '../../social/logic';
import { PostCard } from '../../social/PostCard';
import { spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { EmptyState, ErrorState } from '../../ui';

/** « Mes favoris » : publications enregistrées, la plus récemment enregistrée d'abord ; une publication devenue invisible n'est plus listée. */
export default function Bookmarks() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const query = useInfiniteQuery({
    queryKey: ['bookmarks'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchBookmarks(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  // Retirer un favori depuis cette liste met `bookmarked` à false dans le cache : on le filtre tout de suite.
  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => p.bookmarked !== false) as CachedPost[];
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('creator.bookmarks.title') }} />
      {query.isPending ? (
        <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />
      ) : query.isError && items.length === 0 ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <PostCard post={item} />
            </View>
          )}
          ListEmptyComponent={<EmptyState icon="bookmark-outline" title={t('creator.bookmarks.emptyTitle')} body={t('creator.bookmarks.emptyBody')} />}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : undefined}
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingVertical: spacing.md, gap: spacing.md }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: spacing.xl },
  card: { paddingHorizontal: spacing.md },
});
