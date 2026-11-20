import type { PlatformAnnouncement } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { fetchAnnouncements, o2k } from '../../admin/ops2-api';
import { useI18n } from '../../i18n';
import { Card, PagedList } from '../../seller/ui';
import { spacing } from '../../theme/tokens';
import { Text } from '../../ui';

/** Annonces de la plateforme actives pour moi (l'audience est filtrée par le serveur). */
export default function Announcements() {
  const { t, locale } = useI18n();
  const query = useInfiniteQuery({
    queryKey: o2k.list('announcements'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchAnnouncements(pageParam),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: t('ops2.annUser.title') }} />
      <PagedList
        query={query}
        keyExtractor={(a: PlatformAnnouncement) => a.id}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text variant="bodyStrong" accessibilityRole="header">{item.title}</Text>
            <Text>{item.body}</Text>
            <Text variant="caption" muted>{new Date(item.startsAt).toLocaleDateString(locale)}</Text>
          </Card>
        )}
        empty={{ icon: 'megaphone-outline', title: t('ops2.annUser.empty') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginHorizontal: spacing.md, marginBottom: spacing.sm, gap: spacing.xs },
});
