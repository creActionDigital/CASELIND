import type { ScheduledMessage } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { conversationTitle } from '../../messaging/api';
import type { ConversationPages } from '../../messaging/cache';
import { cancelScheduled, extrasKeys, fetchScheduled } from '../../messaging/extras-api';
import { qk } from '../../messaging/keys';
import { spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { EmptyState, ErrorState, IconButton, Text } from '../../ui';

/** Messages programmés (tous, ou ceux d'une conversation via ?conversationId=) avec annulation. */
export default function Scheduled() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const only = params.conversationId ? String(params.conversationId) : null;
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({ queryKey: extrasKeys.scheduled, queryFn: fetchScheduled });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelScheduled(id),
    onSuccess: () => {
      setNotice(null);
      void qc.invalidateQueries({ queryKey: extrasKeys.scheduled });
    },
    onError: (err) => setNotice(errorMessage(err, t, locale)),
  });

  const titleFor = (conversationId: string): string => {
    for (const [, data] of qc.getQueriesData<ConversationPages>({ queryKey: qk.conversationsAll })) {
      const c = data?.pages.flatMap((p) => p.items).find((x) => x.id === conversationId);
      if (c) return conversationTitle(c, t);
    }
    return '';
  };

  const header = <Stack.Screen options={{ title: t('messagesX.scheduled.title') }} />;
  if (query.isPending) {
    return (
      <View style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        {header}
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (query.isError) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {header}
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </View>
    );
  }
  const items = query.data.items
    .filter((s) => !only || s.conversationId === only)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      {notice ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="assertive" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(s) => s.id}
        contentContainerStyle={items.length === 0 ? styles.grow : undefined}
        ListEmptyComponent={<EmptyState icon="time-outline" title={t('messagesX.scheduled.emptyTitle')} body={t('messagesX.scheduled.emptyBody')} />}
        renderItem={({ item }) => <Row item={item} title={titleFor(item.conversationId)} onCancel={() => cancel.mutate(item.id)} />}
      />
    </View>
  );
}

function Row({ item, title, onCancel }: { item: ScheduledMessage; title: string; onCancel: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const when = new Date(item.scheduledAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const text = item.kind === 'media' ? t('messagesX.scheduled.media') : (item.body ?? '');
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.flex} accessible accessibilityLabel={`${title ? title + ', ' : ''}${t('messagesX.schedule.at', { when })}, ${text}`}>
        {title ? (
          <Text variant="caption" color={colors.primary} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        <Text numberOfLines={3}>{text}</Text>
        <Text variant="caption" muted>
          {t('messagesX.schedule.at', { when })}
        </Text>
      </View>
      <IconButton icon="trash-outline" color={colors.danger} label={t('messagesX.scheduled.cancelA11y', { text })} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  grow: { flexGrow: 1 },
  notice: { padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: spacing.sm, minHeight: TOUCH + 24, borderBottomWidth: StyleSheet.hairlineWidth },
});
