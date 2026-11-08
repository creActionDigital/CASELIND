import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { fetchStoryFeed } from '../stories/api';
import { storyKeys } from '../stories/keys';
import { orderStoryGroups } from '../stories/order';
import { brandColor, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, Text } from '../ui';

/** Rangée de statuts de la liste : réutilise le flux de stories de l'Accueil (même clé de cache, aucun nouvel appel). */
export function ChatStories() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { me } = useAuth();
  const router = useRouter();
  const feed = useQuery({ queryKey: storyKeys.feed, queryFn: fetchStoryFeed });
  const groups = useMemo(() => orderStoryGroups(feed.data?.items ?? [], me?.id), [feed.data, me?.id]);
  const mine = groups.some((g) => g.author.userId === me?.id);
  const others = groups.filter((g) => g.author.userId !== me?.id);
  const open = (userId: string) => router.push({ pathname: '/story/[userId]', params: { userId } });

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.scroll}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={mine ? t('story.bar.mineOpenA11y') : t('story.bar.mineAddA11y')}
        onPress={() => (mine && me ? open(me.id) : router.push('/story/new'))}
        style={styles.item}
      >
        <View style={[styles.ring, { borderColor: colors.border, borderStyle: mine ? 'solid' : 'dashed' }]}>
          <Avatar name={me?.displayName ?? '?'} size={54} />
        </View>
        <Text variant="caption" muted numberOfLines={1}>
          {t('home.stories.mine')}
        </Text>
      </Pressable>
      {others.map((g) => {
        const name = g.author.displayName || g.author.handle;
        return (
          <Pressable
            key={g.author.userId}
            accessibilityRole="button"
            accessibilityLabel={t(g.hasUnseen ? 'story.bar.authorUnseenA11y' : 'story.bar.authorSeenA11y', { name })}
            onPress={() => open(g.author.userId)}
            style={styles.item}
          >
            <View style={[styles.ring, { borderColor: g.hasUnseen ? brandColor : colors.border }]}>
              <Avatar name={name} size={54} />
            </View>
            <Text variant="caption" muted numberOfLines={1}>
              {name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
  item: { alignItems: 'center', gap: spacing.xs, width: 68 },
  ring: { borderWidth: 2.5, borderRadius: 999, padding: 2 },
});
