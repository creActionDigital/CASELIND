import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../../auth/auth-context';
import { useI18n } from '../../../../i18n';
import { errorMessage } from '../../../../lib/errors';
import { qk } from '../../../../messaging/keys';
import { startChatErrorKey } from '../../../../messaging/api';
import { fetchProfile, fetchStats, fetchUserPosts, openDirect, setFollow } from '../../../../social/api';
import { sk } from '../../../../social/keys';
import type { CachedPost } from '../../../../social/logic';
import { PostCard } from '../../../../social/PostCard';
import type { SocialStats } from '../../../../social/types';
import { spacing, TOUCH } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Avatar, Button, EmptyState, ErrorState, Text } from '../../../../ui';

/** Profil social : en-tête (compteurs, Suivre, Message), puis les publications de la personne. */
export default function UserProfile() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const id = String(userId);
  const mine = me?.id === id;
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const profile = useQuery({ queryKey: sk.profile(id), queryFn: () => fetchProfile(id) });
  const stats = useQuery({ queryKey: sk.stats(id), queryFn: () => fetchStats(id) });
  const posts = useInfiniteQuery({
    queryKey: sk.userPosts(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchUserPosts(id, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (posts.data?.pages.flatMap((p) => p.items) ?? []) as CachedPost[];

  const follow = useMutation({
    mutationFn: (on: boolean) => setFollow(id, on),
    onMutate: (on) => {
      const prev = qc.getQueryData<SocialStats>(sk.stats(id));
      qc.setQueryData<SocialStats>(sk.stats(id), (s) =>
        s ? { ...s, isFollowing: on, followersCount: Math.max(0, s.followersCount + (on ? 1 : -1)) } : s,
      );
      return { prev };
    },
    onError: (e, _on, ctx) => {
      qc.setQueryData(sk.stats(id), ctx?.prev);
      setNotice(errorMessage(e, t, locale));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: sk.feed });
      void qc.invalidateQueries({ queryKey: sk.followers(id) });
      void qc.invalidateQueries({ queryKey: ['following'] });
    },
  });

  const message = useMutation({
    mutationFn: () => openDirect(id),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: qk.conversationsAll });
      router.push({ pathname: '/messages/[conversationId]', params: { conversationId: c.id } });
    },
    onError: (e) => {
      const key = startChatErrorKey(e);
      setNotice(key ? t(key) : errorMessage(e, t, locale));
    },
  });

  const title = <Stack.Screen options={{ title: profile.data?.displayName ?? t('profile.social.title') }} />;

  if (profile.isPending) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        {title}
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </SafeAreaView>
    );
  }
  if (profile.isError) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: colors.background }]}>
        {title}
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      </SafeAreaView>
    );
  }

  const p = profile.data;
  const s = stats.data;
  const count = (n: number | undefined, label: string, path: '/user/[userId]/followers' | '/user/[userId]/following') => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${n ?? 0} ${label}`}
      onPress={() => router.push({ pathname: path, params: { userId: id } })}
      style={styles.count}
    >
      <Text variant="heading">{n ?? '–'}</Text>
      <Text variant="caption" muted>
        {label}
      </Text>
    </Pressable>
  );

  const head = (
    <View style={[styles.head, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <Avatar name={p.displayName} size={80} contentUrl={p.avatarUrl} />
      <Text variant="title" style={styles.center} numberOfLines={2}>
        {p.displayName}
      </Text>
      <Text muted>
        @{p.handle}
        {s?.followsYou && !mine ? ` · ${t('profile.social.followsYou')}` : ''}
      </Text>
      <Text style={styles.center} muted={!p.bio}>
        {p.bio ?? t('profile.social.noBio')}
      </Text>
      <View style={styles.counts}>
        {count(s?.followersCount, t('profile.social.followers'), '/user/[userId]/followers')}
        {count(s?.followingCount, t('profile.social.followingLabel'), '/user/[userId]/following')}
      </View>
      {notice ? (
        <Text color={colors.danger} style={styles.center} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {mine ? (
          <Button label={t('profile.social.edit')} variant="secondary" onPress={() => router.push('/profile')} style={styles.flex} />
        ) : (
          <>
            <Button
              label={s?.isFollowing ? t('profile.social.following') : t('profile.social.follow')}
              accessibilityLabel={s?.isFollowing ? t('profile.social.unfollowA11y', { name: p.displayName }) : t('profile.social.follow')}
              variant={s?.isFollowing ? 'secondary' : 'primary'}
              disabled={!s}
              onPress={() => s && follow.mutate(!s.isFollowing)}
              style={styles.flex}
            />
            <Button label={t('profile.social.message')} variant="secondary" loading={message.isPending} onPress={() => message.mutate()} style={styles.flex} />
          </>
        )}
      </View>
      <Text variant="bodyStrong" style={styles.section}>
        {t('profile.social.posts')}
      </Text>
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {title}
      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        renderItem={({ item }) => <PostCard post={item} />}
        ListHeaderComponent={head}
        ListEmptyComponent={
          posts.isPending ? (
            <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />
          ) : posts.isError ? (
            <ErrorState error={posts.error} onRetry={() => posts.refetch()} />
          ) : (
            <EmptyState icon="newspaper-outline" title={t('profile.social.posts')} body={mine ? t('profile.social.noPostsMine') : t('profile.social.noPosts')} />
          )
        }
        ListFooterComponent={posts.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([profile.refetch(), stats.refetch(), posts.refetch()]);
              setRefreshing(false);
            }}
          />
        }
        onEndReached={() => posts.hasNextPage && !posts.isFetchingNextPage && posts.fetchNextPage()}
        onEndReachedThreshold={0.6}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center', alignItems: 'center', justifyContent: 'center' },
  pad: { padding: spacing.xl },
  head: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  counts: { flexDirection: 'row', gap: spacing.xxl, marginVertical: spacing.sm },
  count: { minHeight: TOUCH, minWidth: TOUCH, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch' },
  section: { alignSelf: 'flex-start', marginTop: spacing.md },
});
