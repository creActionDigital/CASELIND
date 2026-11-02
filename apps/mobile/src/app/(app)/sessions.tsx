import { sessionSchema } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { api } from '../../auth/auth-context';
import { useI18n } from '../../i18n';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Badge, Button, EmptyState, ErrorState, Screen, Text } from '../../ui';

const listSchema = z.object({ items: z.array(sessionSchema) });

export default function Sessions() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.request('/auth/sessions', { schema: listSchema }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.request(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  return (
    <Screen edges={['bottom']}>
      {query.isPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState icon="phone-portrait-outline" title={t('sessions.empty')} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {query.data.items.map((s) => {
            const name = s.deviceName ?? t('sessions.unknownDevice');
            return (
              <View key={s.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{name}</Text>
                  <Text variant="small" muted>
                    {s.platform}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </Text>
                  <Text variant="small" muted>
                    {t('sessions.lastUsed', { date: new Date(s.lastUsedAt).toLocaleString(locale) })}
                  </Text>
                </View>
                {s.current ? (
                  <Badge tone="primary" label={t('sessions.current')} />
                ) : (
                  <Button
                    variant="secondary"
                    label={t('sessions.revoke')}
                    accessibilityLabel={t('sessions.revokeA11y', { name })}
                    loading={revoke.isPending && revoke.variables === s.id}
                    onPress={() => revoke.mutate(s.id)}
                  />
                )}
              </View>
            );
          })}
          {revoke.isError ? <ErrorState error={revoke.error} /> : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg },
});
