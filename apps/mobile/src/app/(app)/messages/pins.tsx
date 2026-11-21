import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { messagePreview } from '../../../messaging/api';
import { fetchPins, mdKeys, setPin } from '../../../messaging/module-d-api';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text } from '../../../ui';

/** Messages épinglés d'une conversation : voir dans la conversation, ou désépingler. */
export default function Pins() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = String(conversationId);
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const pins = useQuery({ queryKey: mdKeys.pins(id), queryFn: () => fetchPins(id) });
  const unpin = useMutation({ mutationFn: (messageId: string) => setPin(messageId, false), onSuccess: () => void qc.invalidateQueries({ queryKey: mdKeys.pins(id) }) });
  const header = <Stack.Screen options={{ title: t('md.pin.title') }} />;
  if (pins.isPending) return <View style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>{header}<ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /></View>;
  if (pins.isError) return <View style={[styles.flex, { backgroundColor: colors.background }]}>{header}<ErrorState error={pins.error} onRetry={() => void pins.refetch()} /></View>;
  const items = pins.data.items;
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(p) => p.message.id}
        contentContainerStyle={items.length === 0 ? styles.grow : { padding: spacing.lg, gap: spacing.md }}
        ListEmptyComponent={<EmptyState icon="pin-outline" title={t('md.pin.emptyTitle')} body={t('md.pin.emptyBody')} />}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text numberOfLines={4}>{messagePreview(item.message, t) || t('chat.photo')}</Text>
            <Text variant="caption" muted>{new Date(item.message.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</Text>
            <View style={styles.actions}>
              <Button variant="secondary" label={t('md.pin.go')} onPress={() => router.push({ pathname: '/messages/[conversationId]', params: { conversationId: id, focus: item.message.id } })} />
              <Button variant="ghost" label={t('md.pin.remove')} onPress={() => unpin.mutate(item.message.id)} loading={unpin.isPending && unpin.variables === item.message.id} />
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  grow: { flexGrow: 1 },
  card: { borderRadius: 12, padding: spacing.lg, gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.sm },
});
