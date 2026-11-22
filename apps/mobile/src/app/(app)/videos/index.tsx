import { Ionicons } from '@expo/vector-icons';
import { postListSchema, type Post } from '@caselind/contracts';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { api } from '../../../auth/auth-context';
import { fetchBookmarks, fetchPopularCreators, fetchTrending } from '../../../creator/api';
import { clearVideoHistory, loadVideoHistory } from '../../../creator/video-history';
import { useI18n, type MessageKey } from '../../../i18n';
import { fetchPost } from '../../../social/api';
import type { CachedPost } from '../../../social/logic';
import { PostCard } from '../../../social/PostCard';
import { Card } from '../../../seller/ui';
import { Chip, ChipRow, FadeInView, SkeletonList } from '../../../ui/premium';
import { spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Avatar, Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';

const TABS = ['discover', 'trending', 'creators', 'saved', 'history'] as const;
type Tab = (typeof TABS)[number];

const fetchVideos = (cursor?: string) => api.request('/feed/videos', { query: { limit: 10, cursor }, schema: postListSchema });
const isVideo = (p: Post) => p.kind === 'video';

/** Vidéos : découverte, tendances et hashtags, créateurs populaires, vidéos enregistrées, historique ; accès au plein écran et au centre de création. */
export default function Videos() {
  const { t } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('discover');
  return (
    <Screen>
      <Stack.Screen options={{ title: t('mb.videos.title') }} />
      <View style={styles.row}>
        <Button label={t('mb.videos.fullscreen')} onPress={() => router.push('/hub' as never)} style={[styles.flex, { flex: 0.8 }]} />
        <Button label={t('mb.videos.create')} variant="secondary" onPress={() => router.push('/compose?mode=video' as never)} style={styles.flex} />
      </View>
      <Button label={t('mb.videos.studio')} variant="ghost" onPress={() => router.push('/creator' as never)} />
      <ChipRow>
        {TABS.map((k) => (
          <Chip key={k} label={t(`mb.videos.tab.${k}` as MessageKey)} selected={tab === k} onPress={() => setTab(k)} />
        ))}
      </ChipRow>
      {tab === 'discover' ? <PostList queryKey={['videos', 'discover']} fetcher={fetchVideos} icon="videocam-outline" /> : null}
      {tab === 'trending' ? <Trending /> : null}
      {tab === 'creators' ? <Creators /> : null}
      {tab === 'saved' ? <PostList queryKey={['videos', 'saved']} fetcher={fetchBookmarks} filter={isVideo} icon="bookmark-outline" empty="saved" /> : null}
      {tab === 'history' ? <History /> : null}
    </Screen>
  );
}

function PostList({
  queryKey,
  fetcher,
  filter,
  icon,
  empty = 'discover',
}: {
  queryKey: string[];
  fetcher: (c?: string) => Promise<{ items: Post[]; nextCursor: string | null }>;
  filter?: (p: Post) => boolean;
  icon: 'videocam-outline' | 'bookmark-outline';
  empty?: string;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const q = useInfiniteQuery({ queryKey, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => fetcher(pageParam), getNextPageParam: (l) => l.nextCursor ?? undefined });
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => (filter ? filter(p) : true)) as CachedPost[];
  if (q.isPending) return <SkeletonList rows={3} label={t('common.loading')} />;
  if (q.isError && items.length === 0) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <View style={{ gap: spacing.md }}>
      {items.length === 0 ? <EmptyState icon={icon} title={t(`mb.videos.empty.${empty}` as MessageKey)} body={t(`mb.videos.empty.${empty}.body` as MessageKey)} /> : null}
      {items.map((p, i) => (
        <FadeInView key={p.id} index={i}>
          <PostCard post={p} />
        </FadeInView>
      ))}
      {q.hasNextPage ? <Button variant="secondary" label={t('extra.more')} loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
    </View>
  );
}

function Trending() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const q = useQuery({ queryKey: ['videos', 'trending'], queryFn: fetchTrending });
  if (q.isPending) return <SkeletonList rows={3} label={t('common.loading')} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data.items.length === 0) return <EmptyState icon="pricetag-outline" title={t('mb.videos.empty.trending')} body={t('mb.videos.empty.trending.body')} />;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="heading" accessibilityRole="header">
        {t('mb.videos.hashtags')}
      </Text>
      {q.data.items.map((h, i) => (
        <Card key={h.tag} label={`#${h.tag}`} onPress={() => router.push({ pathname: '/hashtag/[tag]', params: { tag: h.tag } })} style={styles.cardRow}>
          <Text variant="bodyStrong" color={colors.textMuted}>
            {i + 1}
          </Text>
          <Text variant="bodyStrong" style={styles.flex}>
            #{h.tag}
          </Text>
          <Text variant="small" muted>
            {t('mb.videos.posts', { n: h.postsCount })}
          </Text>
        </Card>
      ))}
    </View>
  );
}

function Creators() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const q = useQuery({ queryKey: ['videos', 'creators'], queryFn: fetchPopularCreators });
  if (q.isPending) return <SkeletonList rows={3} label={t('common.loading')} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data.items.length === 0) return <EmptyState icon="people-outline" title={t('mb.videos.empty.creators')} body={t('mb.videos.empty.creators.body')} />;
  return (
    <View style={{ gap: spacing.sm }}>
      {q.data.items.map((c) => (
        <Card key={c.userId} label={c.displayName} onPress={() => router.push({ pathname: '/user/[userId]', params: { userId: c.userId } })} style={styles.cardRow}>
          <Avatar name={c.displayName} size={44} />
          <View style={styles.flex}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {c.displayName}
            </Text>
            <Text variant="small" muted numberOfLines={1}>
              @{c.handle} · {t('mb.videos.followers', { n: c.followersCount })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
      ))}
    </View>
  );
}

function History() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    void loadVideoHistory().then(setIds);
  }, []);
  const posts = useQueries({ queries: (ids ?? []).map((id) => ({ queryKey: ['videos', 'history', id], queryFn: () => fetchPost(id), retry: false })) });
  if (ids === null || (ids.length > 0 && posts.every((p) => p.isPending))) return <SkeletonList rows={3} label={t('common.loading')} />;
  // Une vidéo supprimée ou devenue invisible n'apparaît simplement plus.
  const items = posts.flatMap((p) => (p.data ? [p.data as CachedPost] : []));
  if (items.length === 0) return <EmptyState icon="time-outline" title={t('mb.videos.empty.history')} body={t('mb.videos.empty.history.body')} />;
  return (
    <View style={{ gap: spacing.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('mb.explore.clear')}
        onPress={() => {
          void clearVideoHistory();
          setIds([]);
        }}
        style={styles.clear}
      >
        <Text color={colors.primary}>{t('mb.explore.clear')}</Text>
      </Pressable>
      {items.map((p, i) => (
        <FadeInView key={p.id} index={i}>
          <PostCard post={p} />
        </FadeInView>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  clear: { minHeight: TOUCH, alignSelf: 'flex-end', justifyContent: 'center' },
});
