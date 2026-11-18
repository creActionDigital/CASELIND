import type { MessageSearchHit } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet } from 'react-native';
import { useI18n } from '../i18n';
import { spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { ErrorState, Text } from '../ui';
import { searchMessages } from './social-api';
import { searchReady } from './social-logic';

const DEBOUNCE_MS = 350;

/** Résultats de la recherche dans le texte des messages (GET /messages/search) ; un appui ouvre la conversation au message. */
export function MessageSearchPanel({ query, onOpen }: { query: string; onOpen: (hit: MessageSearchHit) => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);
  const ready = searchReady(q);
  const res = useInfiniteQuery({
    queryKey: ['message-search', q],
    enabled: ready,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => searchMessages(q, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = ready ? (res.data?.pages.flatMap((p) => p.items) ?? []) : [];

  if (!ready) return <Text variant="small" muted style={styles.note}>{t('social.search.hint')}</Text>;
  if (res.isPending) return <ActivityIndicator style={styles.note} color={colors.primary} accessibilityLabel={t('common.loading')} />;
  if (res.isError) return <ErrorState error={res.error} onRetry={() => res.refetch()} />;
  return (
    <FlatList
      data={items}
      keyExtractor={(h) => h.messageId}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={<Text variant="small" muted style={styles.note}>{t('social.search.empty')}</Text>}
      onEndReached={() => res.hasNextPage && !res.isFetchingNextPage && res.fetchNextPage()}
      onEndReachedThreshold={0.4}
      renderItem={({ item }) => {
        const title = item.conversationTitle ?? t('chat.unknownUser');
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('social.search.hit', { title, snippet: item.snippet })}
            onPress={() => onOpen(item)}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <Text variant="bodyStrong" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="small" numberOfLines={2}>
              {item.snippet}
            </Text>
            <Text variant="caption" muted>
              {new Date(item.createdAt).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </Text>
          </Pressable>
        );
      }}
      ListFooterComponent={res.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.note} /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  note: { padding: spacing.lg, textAlign: 'center' },
  row: { minHeight: TOUCH, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
});
