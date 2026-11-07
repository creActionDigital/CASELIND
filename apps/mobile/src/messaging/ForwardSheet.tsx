import type { Conversation } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { uuidv4 } from '../lib/uuid';
import { radius, spacing, TOUCH, typography } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { conversationTitle, fetchConversations } from './api';
import { forwardMessage } from './extras-api';
import { FORWARD_MAX, summarizeForward, toggleDestination, type ForwardSummary } from './extras-logic';
import { qk } from './keys';

interface Props {
  /** Message à transférer ; null = feuille fermée. */
  messageId: string | null;
  onClose: () => void;
}

/** Feuille de transfert : 1 à 10 conversations, recherche, résultat par destination (sans détail sur la cause). */
export function ForwardSheet({ messageId, onClose }: Props) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<(ForwardSummary & { requested: string[] }) | null>(null);
  // Un clientId par ouverture : un réessai est idempotent côté serveur.
  const [clientId, setClientId] = useState(() => uuidv4());

  const list = useInfiniteQuery({
    queryKey: qk.conversations(false),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchConversations(false, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!messageId,
  });
  const all = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const titleOf = (c: Conversation) => conversationTitle(c, t);
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter((c) => conversationTitle(c, t).toLowerCase().includes(q)) : all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, locale]);

  function close() {
    setSelected([]);
    setQuery('');
    setSummary(null);
    setError(null);
    setClientId(uuidv4());
    onClose();
  }

  async function send() {
    if (!messageId || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await forwardMessage(messageId, selected, clientId);
      setSummary({ ...summarizeForward(selected, res.results), requested: selected });
    } catch (err) {
      setError(errorMessage(err, t, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={!!messageId} onClose={close}>
      <Text variant="heading" accessibilityRole="header" style={styles.gap}>
        {t('messagesX.forward.title')}
      </Text>
      {summary ? (
        <View style={{ gap: spacing.sm }}>
          {summary.requested.map((id) => {
            const ok = summary.sent.includes(id);
            const c = byId.get(id);
            return (
              <View key={id} style={[styles.row, { borderBottomColor: colors.border }]} accessible>
                <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={22} color={ok ? colors.success : colors.danger} />
                <Text style={styles.flex} numberOfLines={1}>
                  {c ? titleOf(c) : t('chat.unknownUser')}
                </Text>
                <Text variant="small" color={ok ? colors.success : colors.danger}>
                  {ok ? t('messagesX.forward.sent') : t('messagesX.forward.failed')}
                </Text>
              </View>
            );
          })}
          <Button label={t('messagesX.forward.done')} onPress={close} />
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={t('messagesX.forward.search')}
            placeholder={t('messagesX.forward.search')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            style={[styles.search, typography.body, { color: colors.text, backgroundColor: colors.background, borderColor: colors.border }]}
          />
          <View style={styles.listBox}>
            {list.isPending ? (
              <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
            ) : (
              <FlatList
                data={shown}
                keyExtractor={(c) => c.id}
                keyboardShouldPersistTaps="handled"
                onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
                onEndReachedThreshold={0.5}
                ListEmptyComponent={
                  <Text muted style={styles.empty}>
                    {t('messagesX.forward.noMatch')}
                  </Text>
                }
                renderItem={({ item }) => {
                  const on = selected.includes(item.id);
                  const full = !on && selected.length >= FORWARD_MAX;
                  return (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: full }}
                      accessibilityLabel={titleOf(item)}
                      disabled={full}
                      onPress={() => setSelected((s) => toggleDestination(s, item.id))}
                      style={[styles.row, { borderBottomColor: colors.border, opacity: full ? 0.5 : 1 }]}
                    >
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.primary : colors.textMuted} />
                      <Text style={styles.flex} numberOfLines={1}>
                        {titleOf(item)}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
          <Text variant="caption" muted accessibilityLiveRegion="polite">
            {t('messagesX.forward.selected', { n: selected.length })}
          </Text>
          {error ? (
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="assertive">
              {error}
            </Text>
          ) : null}
          <Button label={t('messagesX.forward.send')} onPress={send} loading={busy} disabled={selected.length === 0} />
          <Button variant="ghost" label={t('common.cancel')} onPress={close} />
        </View>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { minHeight: TOUCH, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md },
  listBox: { maxHeight: 300, minHeight: 80 },
  empty: { textAlign: 'center', padding: spacing.lg },
});
