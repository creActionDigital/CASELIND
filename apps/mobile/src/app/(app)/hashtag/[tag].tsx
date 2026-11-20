import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { fetchTagPosts } from '../../../creator/api';
import { useI18n } from '../../../i18n';
import type { CachedPost } from '../../../social/logic';
import { PostCard } from '../../../social/PostCard';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { EmptyState, ErrorState } from '../../../ui';

/** Publications d'un hashtag que l'utilisateur peut voir, les plus récentes d'abord. */
export default function HashtagScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const query = useInfiniteQuery({
    queryKey: ['hashtag', tag],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchTagPosts(tag!, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!tag,
  });
  const items = (query.data?.pages.flatMap((p) => p.items) ?? []) as CachedPost[];
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('creator.hashtag.title', { tag: tag ?? '' }) }} />
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
          ListEmptyComponent={<EmptyState icon="pricetag-outline" title={t('creator.hashtag.emptyTitle')} body={t('creator.hashtag.emptyBody')} />}
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
