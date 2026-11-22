import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { blockKeys, fetchBlocks, setBlocked } from '../../privacy/api';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Avatar, Button, EmptyState, ErrorState, Screen, Text } from '../../ui';

/** Personnes bloquées : liste (GET /blocks) et déblocage (DELETE /blocks/{userId}). */
export default function Blocked() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: blockKeys.list, queryFn: fetchBlocks });
  const unblock = useMutation({
    mutationFn: (id: string) => setBlocked(id, false),
    onSuccess: () => qc.invalidateQueries({ queryKey: blockKeys.list }),
  });
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('blocks.title') }} />
      <Text muted style={{ marginBottom: spacing.md }}>{t('blocks.intro')}</Text>
      {query.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState icon="ban-outline" title={t('blocks.empty')} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {query.data.items.map((b) => (
            <View key={b.userId} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Avatar name={b.displayName} size={40} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{b.displayName}</Text>
                <Text variant="small" muted>{`@${b.handle} · ${t('blocks.since', { date: new Date(b.blockedAt).toLocaleDateString(locale) })}`}</Text>
              </View>
              <Button
                variant="secondary"
                label={t('blocks.unblock')}
                accessibilityLabel={t('blocks.unblockA11y', { name: b.displayName })}
                loading={unblock.isPending && unblock.variables === b.userId}
                onPress={() => unblock.mutate(b.userId)}
              />
            </View>
          ))}
          {unblock.isError ? <ErrorState error={unblock.error} /> : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg },
});
