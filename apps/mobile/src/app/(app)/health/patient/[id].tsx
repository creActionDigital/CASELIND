import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { fetchSharedRecord, proKeys } from '../../../../health/api';
import { kindKey } from '../../../../health/logic';
import { fetchSharedResults, resultKeys } from '../../../../health/results-api';
import { resultKindKey } from '../../../../health/results-logic';
import { useI18n } from '../../../../i18n';
import { FileLinks } from '../../../../media/FileLinks';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, ErrorState, Screen, Text } from '../../../../ui';

/** Dossier partagé par un patient : seulement les éléments choisis, tant que le partage est actif. Chaque lecture est enregistrée pour le patient. */
export default function SharedRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: proKeys.record(String(id)), queryFn: () => fetchSharedRecord(String(id)), gcTime: 0, staleTime: 0 });
  // 404 tant que le partage ne couvre pas les résultats : la section reste simplement absente.
  const results = useQuery({ queryKey: resultKeys.shared(String(id)), queryFn: () => fetchSharedResults(String(id)), gcTime: 0, staleTime: 0, retry: false });

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
        {results.data ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('health.results.sharedTitle')}
            </Text>
            {results.data.items.length === 0 ? <Text muted>{t('health.results.sharedEmpty')}</Text> : null}
            {results.data.items.map((r) => (
              <View key={r.id} style={[styles.card, { backgroundColor: colors.surface }]}>
                <Badge tone="neutral" label={t(resultKindKey(r.kind))} />
                <Text variant="bodyStrong">{r.title}</Text>
                <Text variant="small" muted>
                  {r.resultDate}
                </Text>
                {r.summary ? <Text variant="small">{r.summary}</Text> : null}
                {r.file ? <FileLinks files={[r.file]} label={t('health.results.file')} /> : null}
              </View>
            ))}
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
