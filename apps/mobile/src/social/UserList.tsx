import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, EmptyState, ErrorState, Text } from '../ui';
import { fetchFollowers, fetchFollowing } from './api';
import { sk } from './keys';

/** Liste paginée des abonnés ou des abonnements d'un utilisateur. */
export function UserList({ kind }: { kind: 'followers' | 'following' }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const id = String(userId);
  const [refreshing, setRefreshing] = useState(false);

  const query = useInfiniteQuery({
    queryKey: kind === 'followers' ? sk.followers(id) : sk.following(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => (kind === 'followers' ? fetchFollowers(id, pageParam) : fetchFollowing(id, pageParam)),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const title = kind === 'followers' ? t('profile.social.followersTitle') : t('profile.social.followingTitle');

  let body;
  if (query.isPending) {
    body = <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />;
  } else if (query.isError && items.length === 0) {
    body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(u) => u.userId}
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
        ListEmptyComponent={
          <EmptyState icon="people-outline" title={title} body={kind === 'followers' ? t('profile.social.noFollowers') : t('profile.social.noFollowing')} />
        }
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : undefined}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        renderItem={({ item: u }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${u.displayName}, @${u.handle}`}
            onPress={() => router.push({ pathname: '/user/[userId]', params: { userId: u.userId } })}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <Avatar name={u.displayName} size={44} />
            <View style={styles.flex}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {u.displayName}
              </Text>
              <Text variant="small" muted numberOfLines={1}>
                @{u.handle}
              </Text>
            </View>
          </Pressable>
        )}
      />
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title }} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: spacing.xl },
  row: { minHeight: TOUCH + 20, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
});
