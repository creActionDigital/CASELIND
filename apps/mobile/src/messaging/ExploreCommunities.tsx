import type { Community } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { qk } from './keys';
import { fetchCommunities, fetchTrendingTags, joinCommunity } from './communities-api';

/** « Explorer les communautés » (maquette communities) : étiquettes tendance, liste, Rejoindre. */
export function ExploreCommunities() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [tag, setTag] = useState<string | undefined>();
  const tags = useQuery({ queryKey: ['community-tags'], queryFn: fetchTrendingTags, staleTime: 5 * 60_000 });
  const list = useQuery({ queryKey: ['communities', tag], queryFn: () => fetchCommunities(tag) });
  const join = useMutation({
    mutationFn: (c: Community) => joinCommunity(c.conversationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['communities'] });
      void qc.invalidateQueries({ queryKey: qk.conversationsAll });
    },
  });

  const open = (c: Community) => router.push({ pathname: '/messages/[conversationId]', params: { conversationId: c.conversationId } });
  const items = list.data?.items ?? [];
  if (!list.isPending && items.length === 0 && !tag) return null;

  return (
    <View style={styles.wrap}>
      <Text variant="bodyStrong" accessibilityRole="header" style={styles.title}>
        {t('chat.explore.title')}
      </Text>
      {(tags.data?.items.length ?? 0) > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tags}>
          {tags.data!.items.map((x) => {
            const on = tag === x.tag;
            return (
              <Pressable
                key={x.tag}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setTag(on ? undefined : x.tag)}
                style={[styles.tag, { backgroundColor: on ? colors.primary : colors.surface }]}
              >
                <Text variant="small" color={on ? colors.onPrimary : colors.text}>{`#${x.tag}`}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {join.isError ? (
        <Text variant="small" color={colors.danger} style={styles.title} accessibilityLiveRegion="polite">
          {errorMessage(join.error, t, locale)}
        </Text>
      ) : null}
      {items.map((c) => (
        <View key={c.conversationId} style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.flex}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {c.title}
            </Text>
            {c.description ? (
              <Text variant="small" muted numberOfLines={2}>
                {c.description}
              </Text>
            ) : null}
            <Text variant="small" muted>
              {t(c.memberCount === 1 ? 'chat.explore.member' : 'chat.explore.members', { n: c.memberCount })}
            </Text>
          </View>
          <Button
            variant={c.joined ? 'secondary' : 'primary'}
            label={c.joined ? t('chat.explore.open') : t('chat.explore.join')}
            loading={join.isPending && join.variables?.conversationId === c.conversationId}
            onPress={() => (c.joined ? open(c) : join.mutate(c))}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { marginBottom: spacing.md, gap: spacing.sm },
  title: { paddingHorizontal: spacing.lg },
  tags: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  tag: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  card: { marginHorizontal: spacing.lg, padding: spacing.md, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
