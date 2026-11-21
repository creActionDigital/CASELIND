import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { clKeys, fetchCalls, startCall } from '../../../calllive/api';
import { useI18n } from '../../../i18n';
import { conversationTitle, fetchConversation } from '../../../messaging/api';
import { callHistory, type CallRow } from '../../../messaging/module-d-logic';
import { qk } from '../../../messaging/keys';
import { spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { EmptyState, ErrorState, Text } from '../../../ui';

function Row({ row }: { row: CallRow }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const conv = useQuery({ queryKey: qk.conversation(row.conversationId), queryFn: () => fetchConversation(row.conversationId) });
  const title = conv.data ? conversationTitle(conv.data, t) : '…';
  const bad = row.outcome === 'missed' || row.outcome === 'declined';
  const status =
    row.outcome === 'done'
      ? t('md.calls.duration', { min: Math.floor(row.seconds / 60), sec: row.seconds % 60 })
      : t(`md.calls.${row.outcome}` as 'md.calls.missed');
  const when = new Date(row.at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const kindLabel = row.kind === 'video' ? t('md.calls.video') : t('md.calls.audio');
  const dir = row.direction === 'in' ? t('md.calls.in') : t('md.calls.out');
  async function callBack() {
    try {
      const c = await startCall(row.conversationId, row.kind);
      router.push({ pathname: '/calls/[id]', params: { id: c.id } });
    } catch {
      router.push({ pathname: '/messages/[conversationId]', params: { conversationId: row.conversationId } });
    }
  }
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${kindLabel}, ${dir}, ${status}, ${when}. ${t('md.calls.open')}`}
        onPress={() => router.push({ pathname: '/messages/[conversationId]', params: { conversationId: row.conversationId } })}
        style={styles.main}
      >
        <Ionicons name={row.direction === 'in' ? 'arrow-down-outline' : 'arrow-up-outline'} size={20} color={bad ? colors.danger : colors.primary} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontWeight: '600' }}>{title}</Text>
          <Text variant="caption" muted>{`${dir} · ${status} · ${when}`}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${kindLabel}: ${title}`} onPress={() => void callBack()} hitSlop={8} style={styles.btn}>
        <Ionicons name={row.kind === 'video' ? 'videocam-outline' : 'call-outline'} size={22} color={colors.primary} />
      </Pressable>
    </View>
  );
}

/** Historique des appels audio et vidéo de l'utilisateur ; un tap ouvre la conversation, l'icône rappelle. */
export default function CallHistory() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { me } = useAuth();
  const calls = useQuery({ queryKey: clKeys.calls, queryFn: fetchCalls });
  const header = <Stack.Screen options={{ title: t('md.calls.title') }} />;
  if (calls.isPending) return <View style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>{header}<ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /></View>;
  if (calls.isError) return <View style={[styles.flex, { backgroundColor: colors.background }]}>{header}<ErrorState error={calls.error} onRetry={() => void calls.refetch()} /></View>;
  const rows = callHistory(calls.data.items, me?.id ?? '');
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <Row row={item} />}
        refreshing={calls.isRefetching}
        onRefresh={() => void calls.refetch()}
        ListEmptyComponent={<EmptyState icon="call-outline" title={t('md.calls.emptyTitle')} body={t('md.calls.emptyBody')} />}
        contentContainerStyle={rows.length === 0 ? styles.grow : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  grow: { flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH + 16 },
  btn: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
