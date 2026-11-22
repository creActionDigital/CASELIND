import type { StoryGroup } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../auth/auth-context';
import { SheetModal } from '../../../components/SheetModal';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { openReport } from '../../../report/open-report';
import { fetchProfile } from '../../../social/api';
import { deleteStory, fetchStoryFeed, fetchUserStories, fetchStoryViewers, markStoryViewed } from '../../../stories/api';
import { storyKeys } from '../../../stories/keys';
import { orderStoryGroups } from '../../../stories/order';
import { next, previous, startPosition, STORY_DURATION_MS, type ViewerPos, type ViewerResult } from '../../../stories/viewer-machine';
import { dark, radius, spacing, TOUCH } from '../../../theme/tokens';
import { Avatar, AuthImage, Button, ErrorState, IconButton, Text } from '../../../ui';
import { ActivityIndicator } from 'react-native';

/** Visionneuse de stories (plein écran, fond noir) : enchaîne les auteurs de la barre. */
export default function StoryViewer() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const insets = useSafeAreaInsets();
  const feed = useQuery({ queryKey: storyKeys.feed, queryFn: fetchStoryFeed });

  // Ordre figé à l'ouverture : marquer une story « vue » ne doit pas réordonner la lecture en cours.
  const [groups, setGroups] = useState<StoryGroup[] | null>(null);
  const [pos, setPos] = useState<ViewerPos | null>(null);
  // Une personne absente de la barre (ouverte depuis son profil) : ses statuts visibles viennent de GET /users/{id}/stories.
  const inFeed = feed.data?.items.some((g) => g.author.userId === userId) ?? false;
  const extra = useQuery({
    queryKey: ['user-stories', userId],
    enabled: feed.data !== undefined && !inFeed,
    queryFn: async (): Promise<StoryGroup | null> => {
      const [s, p] = await Promise.all([fetchUserStories(userId), fetchProfile(userId)]);
      return s.items.length === 0 ? null : { author: { userId, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl }, stories: s.items, hasUnseen: s.items.some((x) => !x.seen) };
    },
  });
  useEffect(() => {
    if (groups || !feed.data || (!inFeed && extra.isPending)) return;
    const ordered = orderStoryGroups(extra.data ? [...feed.data.items, extra.data] : feed.data.items, me?.id);
    setGroups(ordered);
    setPos(startPosition(ordered, userId));
  }, [feed.data, groups, me?.id, userId, inFeed, extra.isPending, extra.data]);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion, () => undefined);
  }, []);

  const [holding, setHolding] = useState(false);
  const [menu, setMenu] = useState<'none' | 'menu' | 'confirm' | 'viewers'>('none');
  const [notice, setNotice] = useState<string | null>(null);
  const paused = holding || menu !== 'none';

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  useEffect(
    () => () => {
      qc.invalidateQueries({ queryKey: storyKeys.feed });
    },
    [qc],
  );

  const group = groups && pos ? groups[pos.group] : undefined;
  const story = group && pos ? group.stories[pos.story] : undefined;
  const mine = !!story && story.authorId === me?.id;

  const apply = useCallback(
    (r: ViewerResult) => {
      if (r.kind === 'close') close();
      else setPos(r.pos);
    },
    [close],
  );
  const goNext = useCallback(() => groups && pos && apply(next(groups, pos)), [groups, pos, apply]);
  const goPrev = useCallback(() => groups && pos && apply(previous(groups, pos)), [groups, pos, apply]);
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  // Progression : une minuterie linéaire par story, suspendue en pause, reprise là où elle s'est arrêtée.
  const progress = useRef(new Animated.Value(0)).current;
  const fraction = useRef(0);
  const storyId = story?.id;
  useEffect(() => {
    progress.setValue(0);
    fraction.current = 0;
  }, [storyId, progress]);
  useEffect(() => {
    if (!storyId || paused) return;
    const sub = progress.addListener(({ value }) => {
      fraction.current = value;
    });
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(50, STORY_DURATION_MS * (1 - fraction.current)),
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) goNextRef.current();
    });
    return () => {
      anim.stop();
      progress.removeListener(sub);
    };
  }, [storyId, paused, progress]);

  // POST /view une seule fois par story affichée (les siennes et les déjà vues sont ignorées).
  const viewed = useRef(new Set<string>());
  useEffect(() => {
    if (!story || mine || story.seen || viewed.current.has(story.id)) return;
    viewed.current.add(story.id);
    markStoryViewed(story.id).catch(() => viewed.current.delete(story.id));
  }, [story, mine]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 16 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 80) close();
        },
      }),
    [close],
  );

  async function remove() {
    if (!story || !groups || !pos) return;
    try {
      await deleteStory(story.id);
    } catch (err) {
      setMenu('none');
      setNotice(errorMessage(err, t, locale));
      return;
    }
    setMenu('none');
    const stories = group!.stories.filter((s) => s.id !== story.id);
    if (stories.length > 0) {
      setGroups(groups.map((g, i) => (i === pos.group ? { ...g, stories } : g)));
      setPos({ group: pos.group, story: Math.min(pos.story, stories.length - 1) });
    } else {
      const rest = groups.filter((_, i) => i !== pos.group);
      if (rest.length === 0 || pos.group >= rest.length) {
        close();
      } else {
        setGroups(rest);
        setPos({ group: pos.group, story: 0 });
      }
    }
  }

  const header = (
    <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
      {group && pos ? (
        <View style={styles.bars} accessibilityRole="progressbar" accessibilityLabel={t('story.viewer.progressA11y', { n: pos.story + 1, total: group.stories.length })}>
          {group.stories.map((s, i) => (
            <View key={s.id} style={[styles.track, { backgroundColor: dark.border }]}>
              {i < pos.story || (i === pos.story && reduceMotion) ? (
                <View style={[styles.fill, { backgroundColor: dark.text, width: '100%' }]} />
              ) : i === pos.story ? (
                <Animated.View
                  style={[styles.fill, { backgroundColor: dark.text, width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.headRow}>
        {group ? <Avatar name={group.author.displayName || group.author.handle} size={36} /> : <View style={{ width: 36 }} />}
        <View style={{ flex: 1 }}>
          {group ? (
            <>
              <Text variant="bodyStrong" color={dark.text} numberOfLines={1}>
                {mine ? t('home.stories.mine') : group.author.displayName}
              </Text>
              {story ? (
                <Text variant="caption" color={dark.textMuted}>
                  {new Date(story.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
        {story ? <IconButton icon="ellipsis-horizontal" label={t('story.viewer.menuA11y')} color={dark.text} onPress={() => setMenu('menu')} /> : null}
        <IconButton icon="close" label={t('common.close')} color={dark.text} onPress={close} />
      </View>
    </View>
  );

  let body;
  if (feed.isPending || (feed.data && !groups)) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={dark.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  } else if (feed.isError) {
    body = (
      <View style={styles.center}>
        <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
      </View>
    );
  } else if (!story) {
    body = (
      <View style={styles.center}>
        <View style={{ alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl }}>
          <Text variant="heading" color={dark.text} style={{ textAlign: 'center' }}>{t('story.viewer.emptyTitle')}</Text>
          <Text color={dark.text} style={{ textAlign: 'center', opacity: 0.75 }}>{t('story.viewer.emptyBody')}</Text>
          <Button label={t('common.close')} variant="secondary" onPress={close} />
        </View>
      </View>
    );
  } else {
    body = (
      <>
        <AuthImage contentUrl={story.mediaUrl} label={story.caption ?? t('story.viewer.imageA11y')} style={styles.image} />
        <View style={styles.zones} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('story.viewer.prevA11y')}
            onPress={goPrev}
            onPressIn={() => setHolding(false)}
            onLongPress={() => setHolding(true)}
            delayLongPress={250}
            onPressOut={() => setHolding(false)}
            style={styles.zoneLeft}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('story.viewer.nextA11y')}
            onPress={goNext}
            onLongPress={() => setHolding(true)}
            delayLongPress={250}
            onPressOut={() => setHolding(false)}
            style={styles.zoneRight}
          />
        </View>
      </>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: dark.background }]} {...pan.panHandlers}>
      {body}
      {header}
      {story ? (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
          {story.caption ? (
            <View style={[styles.caption, { backgroundColor: dark.overlay }]}>
              <Text color={dark.text}>{story.caption}</Text>
            </View>
          ) : null}
          {mine ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('story.viewer.viewsA11y', { n: story.viewCount ?? 0 })}
              onPress={() => setMenu('viewers')}
              style={[styles.views, { backgroundColor: dark.overlay }]}
            >
              <Ionicons name="eye-outline" size={20} color={dark.text} />
              <Text color={dark.text}>{story.viewCount ?? 0}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {notice ? (
        <Pressable onPress={() => setNotice(null)} accessibilityRole="alert" style={[styles.notice, { backgroundColor: dark.dangerSoft, top: insets.top + 80 }]}>
          <Text variant="small" color={dark.danger}>
            {notice}
          </Text>
        </Pressable>
      ) : null}

      <SheetModal visible={menu === 'menu' || menu === 'confirm'} onClose={() => setMenu('none')}>
        {story && menu === 'menu' ? (
          <View style={{ gap: spacing.sm }}>
            {mine ? (
              <>
                <Button variant="secondary" label={t('story.viewer.viewers')} onPress={() => setMenu('viewers')} />
                <Button variant="danger" label={t('story.viewer.delete')} onPress={() => setMenu('confirm')} />
              </>
            ) : (
              <Button
                variant="secondary"
                label={t('report.action')}
                onPress={() => {
                  setMenu('none');
                  openReport({ targetType: 'story', targetId: story.id });
                }}
              />
            )}
            <Button variant="ghost" label={t('common.cancel')} onPress={() => setMenu('none')} />
          </View>
        ) : null}
        {menu === 'confirm' ? (
          <View style={{ gap: spacing.md }}>
            <Text variant="heading" accessibilityRole="header">
              {t('story.viewer.deleteTitle')}
            </Text>
            <Text muted>{t('story.viewer.deleteBody')}</Text>
            <Button variant="danger" label={t('story.viewer.delete')} onPress={remove} />
            <Button variant="ghost" label={t('common.cancel')} onPress={() => setMenu('none')} />
          </View>
        ) : null}
      </SheetModal>
      <ViewersSheet storyId={menu === 'viewers' ? story?.id : undefined} onClose={() => setMenu('none')} />
    </View>
  );
}

/** Feuille des spectateurs (auteur seul) : GET /stories/:id/viewers, pagination par curseur. */
function ViewersSheet({ storyId, onClose }: { storyId?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const q = useInfiniteQuery({
    queryKey: storyKeys.viewers(storyId ?? ''),
    queryFn: ({ pageParam }) => fetchStoryViewers(storyId!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!storyId,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <SheetModal visible={!!storyId} onClose={onClose}>
      <Text variant="heading" accessibilityRole="header" style={{ marginBottom: spacing.md }}>
        {t('story.viewer.viewers')}
      </Text>
      {q.isPending ? (
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <Text muted>{t('story.viewer.noViewers')}</Text>
      ) : (
        <View style={{ gap: spacing.sm, maxHeight: 360 }}>
          {items.map((v) => (
            <View key={v.userId} style={styles.viewer}>
              <Avatar name={v.displayName || v.handle} size={40} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1}>{v.displayName}</Text>
                <Text variant="caption" muted>
                  @{v.handle} · {new Date(v.viewedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          ))}
          {q.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} /> : null}
        </View>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { ...StyleSheet.absoluteFill, borderRadius: 0 },
  zones: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  zoneLeft: { flex: 1 },
  zoneRight: { flex: 2 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md, gap: spacing.sm },
  bars: { flexDirection: 'row', gap: 4 },
  track: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'flex-start' },
  caption: { borderRadius: radius.md, padding: spacing.md, alignSelf: 'stretch' },
  views: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, borderRadius: radius.pill },
  notice: { position: 'absolute', left: spacing.lg, right: spacing.lg, padding: spacing.md, borderRadius: radius.md },
  viewer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH },
});
