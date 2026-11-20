import type { StoryGroup } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { fonts, radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Text } from '../ui';

const AV = 60;
import { fetchStoryFeed } from './api';
import { storyKeys } from './keys';
import { orderStoryGroups } from './order';

/** Barre des statuts de l'Accueil : « Mon statut » puis un avatar par auteur (anneau bleu = non vus, rouge + badge LIVE = en direct). */
export function StoriesBar() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { me } = useAuth();
  const router = useRouter();
  const feed = useQuery({ queryKey: storyKeys.feed, queryFn: fetchStoryFeed });
  const groups = useMemo(() => orderStoryGroups(feed.data?.items ?? [], me?.id), [feed.data, me?.id]);
  const mine = groups.find((g) => g.author.userId === me?.id);
  const others = groups.filter((g) => g.author.userId !== me?.id);

  const open = (userId: string) => router.push({ pathname: '/story/[userId]', params: { userId } });
  const create = () => router.push('/story/new');

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <View style={styles.item}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mine ? t('story.bar.mineOpenA11y') : t('story.bar.mineAddA11y')}
            onPress={() => (mine && me ? open(me.id) : create())}
            style={styles.touch}
          >
            <View style={[styles.ring, { borderColor: mine ? colors.primary : colors.border, borderStyle: mine ? 'solid' : 'dashed' }]}>
              <Avatar name={me?.displayName ?? '?'} size={AV} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('story.bar.mineAddA11y')}
            onPress={create}
            hitSlop={12}
            style={[styles.plus, { backgroundColor: colors.primary, borderColor: colors.surface }]}
          >
            <Ionicons name="add" size={14} color={colors.onPrimary} />
          </Pressable>
          <Text variant="caption" muted numberOfLines={1} style={styles.label}>
            {t('home.stories.mine')}
          </Text>
        </View>
        {others.map((g) => (
          <AuthorBubble key={g.author.userId} group={g} onPress={() => open(g.author.userId)} />
        ))}
        {feed.isPending ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
        {feed.isError ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('story.bar.retryA11y')} onPress={() => feed.refetch()} style={styles.retry}>
            <Ionicons name="refresh" size={18} color={colors.textMuted} />
            <Text variant="small" muted>
              {t('story.bar.error')}
            </Text>
          </Pressable>
        ) : null}
        {feed.isSuccess && others.length === 0 ? (
          <Text variant="small" muted style={styles.empty}>
            {t('home.stories.empty')}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** `live` : réservé à l'information « en direct » quand l'API la fournira ; sans elle, seul le style existe. */
function AuthorBubble({ group, onPress, live }: { group: StoryGroup; onPress: () => void; live?: boolean }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const name = group.author.displayName || group.author.handle;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(group.hasUnseen ? 'story.bar.authorUnseenA11y' : 'story.bar.authorSeenA11y', { name })}
      onPress={onPress}
      style={styles.item}
    >
      <View style={[styles.ring, { borderColor: live ? colors.accent : group.hasUnseen ? colors.primary : colors.border }]}>
        <Avatar name={name} size={AV} />
        {live ? (
          <View style={[styles.live, { backgroundColor: colors.accent, borderColor: colors.surface }]} importantForAccessibility="no-hide-descendants">
            <Text variant="caption" color={colors.onAccent} style={styles.liveText}>
              {t('home.live')}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" muted={!group.hasUnseen} numberOfLines={1} style={styles.label}>
        {name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  row: { alignItems: 'flex-start', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
  item: { alignItems: 'center', gap: spacing.xs, width: 76 },
  touch: { minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 3, borderRadius: radius.pill, padding: 2, alignItems: 'center' },
  label: { fontFamily: fonts.medium },
  plus: { position: 'absolute', right: 6, top: 44, width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  live: { position: 'absolute', bottom: -6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, borderWidth: 2 },
  liveText: { fontSize: 10, lineHeight: 13, fontWeight: '700' },
  retry: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'center' },
  empty: { maxWidth: 220, alignSelf: 'center' },
});
