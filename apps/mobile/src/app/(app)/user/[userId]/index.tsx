import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
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
import { PaySheet, type PayTarget } from '../../../../creator/PaySheet';
import { PostCard } from '../../../../social/PostCard';
import { useWalletEnabled } from '../../../../wallet/hooks';
import type { SocialStats } from '../../../../social/types';
import { spacing, TOUCH } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { AuthImage, Avatar, Button, EmptyState, ErrorState, Text } from '../../../../ui';
import { PremiumBadge } from '../../../../premium/PremiumBadge';

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
  const walletOn = useWalletEnabled() === true;
  const [pay, setPay] = useState<PayTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'posts' | 'media'>('posts');

  const profile = useQuery({ queryKey: sk.profile(id), queryFn: () => fetchProfile(id) });
  const stats = useQuery({ queryKey: sk.stats(id), queryFn: () => fetchStats(id) });
  const posts = useInfiniteQuery({
    queryKey: sk.userPosts(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchUserPosts(id, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const all = (posts.data?.pages.flatMap((p) => p.items) ?? []) as CachedPost[];
  // Onglet « Photos et vidéos » : publications avec média, en grille.
  const items = tab === 'media' ? all.filter((p) => p.media.length > 0) : all;

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
      {/* Couverture : aplat de marque (pas de dégradé), l'avatar la chevauche. */}
      <View style={[styles.cover, { backgroundColor: colors.primary }]} importantForAccessibility="no-hide-descendants" />
      <View style={[styles.avatarRing, { backgroundColor: colors.surface }]}>
        <Avatar name={p.displayName} size={88} contentUrl={p.avatarUrl} />
      </View>
      <Text variant="title" style={styles.center} numberOfLines={2}>
        {p.displayName}
      </Text>
      <View style={{ alignItems: "center" }}>
        <PremiumBadge userId={p.id} />
      </View>
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
            {walletOn ? <Button label={t('creator.tip.action')} variant="secondary" onPress={() => setPay({ mode: 'tip', userId: id, name: p.displayName })} style={styles.flex} /> : null}
          </>
        )}
      </View>
      <PaySheet target={pay} onClose={() => setPay(null)} />
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['posts', 'media'] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
            onPress={() => setTab(k)}
            style={[styles.tabBtn, { borderBottomColor: tab === k ? colors.primary : 'transparent' }]}
          >
            <Text variant="bodyStrong" color={tab === k ? colors.primary : colors.textMuted}>
              {t(k === 'posts' ? 'profile.social.posts' : 'ma.profile.media')}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {title}
      <FlatList
        key={tab}
        data={items}
        numColumns={tab === 'media' ? 3 : 1}
        keyExtractor={(x) => x.id}
        renderItem={({ item }) =>
          tab === 'media' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.media[0]?.mime?.startsWith('video') ? t('ma.profile.videoA11y') : t('ma.profile.photoA11y')}
              onPress={() => router.push({ pathname: '/post/[postId]', params: { postId: item.id } })}
              style={styles.tile}
            >
              {item.media[0]?.mime?.startsWith('video') ? (
                <View style={[styles.fill, styles.center, { backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons name="play-circle" size={36} color={colors.primary} />
                </View>
              ) : (
                <AuthImage contentUrl={item.media[0]?.contentUrl ?? null} localUri={item.local ? (item.media[0] as { localUri?: string })?.localUri : undefined} label={t('ma.profile.photoA11y')} style={styles.fill} />
              )}
            </Pressable>
          ) : (
            <PostCard post={item} />
          )
        }
        ListHeaderComponent={head}
        ListEmptyComponent={
          posts.isPending ? (
            <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />
          ) : posts.isError ? (
            <ErrorState error={posts.error} onRetry={() => posts.refetch()} />
          ) : (
            <EmptyState icon="newspaper-outline" title={t('profile.social.posts')} body={tab === 'media' ? t('ma.profile.noMedia') : mine ? t('profile.social.noPostsMine') : t('profile.social.noPosts')} />
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
  tabs: { flexDirection: 'row', alignSelf: 'stretch', marginTop: spacing.md },
  tabBtn: { flex: 1, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2 },
  tile: { width: '33.333%', aspectRatio: 1, padding: 1 },
  fill: { flex: 1, width: '100%', height: '100%' },
  flex: { flex: 1 },
  center: { textAlign: 'center', alignItems: 'center', justifyContent: 'center' },
  pad: { padding: spacing.xl },
  head: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg, paddingTop: 96 + spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, height: 96 },
  avatarRing: { marginTop: -56, padding: 4, borderRadius: 48 },
  counts: { flexDirection: 'row', gap: spacing.xxl, marginVertical: spacing.sm },
  count: { minHeight: TOUCH, minWidth: TOUCH, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch' },
  section: { alignSelf: 'flex-start', marginTop: spacing.md },
});
