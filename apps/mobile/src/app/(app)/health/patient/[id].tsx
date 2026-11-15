import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { fetchSharedRecord, proKeys } from '../../../../health/api';
import { kindKey } from '../../../../health/logic';
import { useI18n } from '../../../../i18n';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, ErrorState, Screen, Text } from '../../../../ui';

/** Dossier partagé par un patient : seulement les éléments choisis, tant que le partage est actif. Chaque lecture est enregistrée pour le patient. */
export default function SharedRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: proKeys.record(String(id)), queryFn: () => fetchSharedRecord(String(id)), gcTime: 0, staleTime: 0 });

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (q.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Screen>
    );
  }
  const r = q.data;
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: r.patient.displayName }} />
      <View style={styles.body}>
        <Text variant="small" muted>
          {t('health.share.active', { date: new Date(r.expiresAt).toLocaleDateString(locale) })} · {t('health.pro.readNote')}
        </Text>
        {r.entries.length === 0 ? <Text muted>{t('health.recordEmpty')}</Text> : null}
        {r.entries.map((e, i) => (
          <View key={i} style={[styles.card, { backgroundColor: colors.surface }]}>
            <Badge tone="neutral" label={t(kindKey(e.kind))} />
            <Text variant="bodyStrong">{e.title}</Text>
            <Text variant="small" muted>
              {e.recordedOn}
            </Text>
            {e.details ? <Text variant="small">{e.details}</Text> : null}
            {e.severity !== null ? <Text variant="small">{t('health.severityOf', { n: e.severity })}</Text> : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
