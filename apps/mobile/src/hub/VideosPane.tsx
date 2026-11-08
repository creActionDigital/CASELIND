import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { getAuthMediaUri } from '../media/auth-media';
import { api } from '../auth/auth-context';
import { useReact } from '../social/hooks';
import { nextReaction, totalReactions, type CachedPost } from '../social/logic';
import { glass, onMedia, TAB_BAR_SPACE, TOUCH } from '../theme/tokens';
import { Avatar, EmptyState, ErrorState, Text } from '../ui';
import { postListSchema } from '@caselind/contracts';
import { formatCount } from './logic';

const fetchVideos = (cursor?: string) => api.request('/feed/videos', { query: { limit: 10, cursor }, schema: postListSchema });

function Surface({ uri, active }: { uri: string; active: boolean }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

function Page({ post, active, height }: { post: CachedPost; active: boolean; height: number }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const react = useReact(post);
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const video = post.media.find((m) => m.mime?.startsWith('video/'));
  const contentUrl = video?.contentUrl ?? null;

  useEffect(() => {
    if (!active || !contentUrl || uri) return;
    let live = true;
    getAuthMediaUri(contentUrl).then(
      (u) => live && setUri(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [active, contentUrl, uri]);

  const liked = post.myReaction != null;
  const open = () => router.push({ pathname: '/post/[postId]', params: { postId: post.id } });
  return (
    <View style={[styles.page, { height }]}>
      {uri ? <Surface uri={uri} active={active} /> : null}
      {!uri && active && !failed ? <ActivityIndicator color={onMedia} style={StyleSheet.absoluteFill} accessibilityLabel={t('common.loading')} /> : null}
      {failed ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Text color={onMedia}>{t('media.unavailable')}</Text>
        </View>
      ) : null}
      <View style={[styles.actions, { bottom: TAB_BAR_SPACE + 24 }]}>
        <Action
          icon={liked ? 'heart' : 'heart-outline'}
          color={liked ? '#FF6B81' : onMedia}
          label={t('hub.react')}
          count={formatCount(totalReactions(post.reactions), locale)}
          onPress={() => react.mutate(nextReaction(post.myReaction, 'love'))}
        />
        <Action icon="chatbubble-outline" label={t('hub.comments')} count={formatCount(post.commentsCount, locale)} onPress={open} />
        <Action
          icon="arrow-redo-outline"
          label={t('hub.share')}
          onPress={() => void Share.share({ message: post.body ?? `${post.author.displayName} (@${post.author.handle})` }).catch(() => {})}
        />
      </View>
      <View style={[styles.info, { paddingBottom: TAB_BAR_SPACE - 8 + 0 * insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('feed.author', { name: post.author.displayName })}
          onPress={() => router.push({ pathname: '/user/[userId]', params: { userId: post.author.id } })}
          style={styles.author}
        >
          <Avatar name={post.author.displayName} size={36} />
          <Text variant="bodyStrong" color={onMedia} numberOfLines={1} style={styles.flex}>
            @{post.author.handle}
          </Text>
        </Pressable>
        {post.body ? (
          <Text color={onMedia} numberOfLines={3}>
            {post.body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Action({ icon, label, count, color = onMedia, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; count?: string; color?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={count ? `${label} (${count})` : label} onPress={onPress} style={styles.action}>
      <View style={styles.actionDisc}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      {count ? (
        <Text variant="caption" color={onMedia}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Flux vertical plein écran, une vidéo par page ; seule la page visible est lue. */
export function VideosPane({ active, height }: { active: boolean; height: number }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const q = useInfiniteQuery({
    queryKey: ['hub-videos'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchVideos(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []) as CachedPost[];

  if (q.isPending) return <ActivityIndicator style={styles.state} color={onMedia} accessibilityLabel={t('common.loading')} />;
  if (q.isError && items.length === 0) {
    return (
      <View style={styles.state}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={styles.state}>
        <EmptyState icon="videocam-outline" title={t('hub.videos.empty')} body={t('hub.videos.emptyBody')} />
      </View>
    );
  }
  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      renderItem={({ item, index: i }) => <Page post={item} active={active && i === index} height={height} />}
      pagingEnabled
      snapToInterval={height}
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      getItemLayout={(_d, i) => ({ length: height, offset: height * i, index: i })}
      onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.y / height))}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      onEndReachedThreshold={1}
      windowSize={3}
    />
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#0B0B10', justifyContent: 'flex-end' },
  center: { alignItems: 'center', justifyContent: 'center' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flexShrink: 1 },
  actions: { position: 'absolute', right: 10, alignItems: 'center', gap: 14 },
  action: { alignItems: 'center', minWidth: TOUCH, gap: 2 },
  actionDisc: {
    width: TOUCH + 4,
    height: TOUCH + 4,
    borderRadius: (TOUCH + 4) / 2,
    backgroundColor: glass.dark,
    borderWidth: 1,
    borderColor: glass.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { paddingHorizontal: 14, paddingTop: 14, paddingRight: 80, gap: 8, backgroundColor: 'rgba(0,0,0,0.45)' },
  author: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: TOUCH },
});
