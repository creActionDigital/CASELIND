import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { eraseHealthData, fetchConsent, fetchDoses, grantConsent, healthKeys, resolveDose, revokeConsent } from '../../../health/api';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text } from '../../../ui';

/** Santé personnelle : consentement explicite d'abord, puis prises à valider, dossier, rappels. Jamais de conseil médical. */
export default function Health() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const consent = useQuery({ queryKey: healthKeys.consent, queryFn: fetchConsent });
  const granted = consent.data?.granted === true;
  const doses = useQuery({ queryKey: healthKeys.doses, queryFn: fetchDoses, enabled: granted });

  const refresh = () => {
    setError(null);
    setConfirmErase(false);
    void qc.invalidateQueries({ queryKey: healthKeys.all });
  };
  const fail = (e: unknown) => setError(errorMessage(e, t, locale));
  const grant = useMutation({ mutationFn: grantConsent, onSuccess: refresh, onError: fail });
  const revoke = useMutation({ mutationFn: revokeConsent, onSuccess: refresh, onError: fail });
  const erase = useMutation({ mutationFn: eraseHealthData, onSuccess: refresh, onError: fail });
  const resolve = useMutation({ mutationFn: (v: { id: string; status: 'taken' | 'skip' }) => resolveDose(v.id, v.status), onSuccess: refresh, onError: fail });

  if (consent.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (consent.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={consent.error} onRetry={() => consent.refetch()} />
      </Screen>
    );
  }
  const limits = (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text variant="small" muted>
        {t('health.limits')}
      </Text>
    </View>
  );
  const pending = (doses.data?.items ?? []).filter((d) => d.status === 'pending');

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('health.title') }} />
      <View style={styles.body}>
        {limits}
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {!granted ? (
          <>
            <Text variant="title" accessibilityRole="header">
              {t('health.consent.title')}
            </Text>
            <Text>{t('health.consent.body')}</Text>
            <Button label={t('health.consent.accept')} loading={grant.isPending} onPress={() => grant.mutate()} />
          </>
        ) : (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('health.dosesTitle')}
            </Text>
            {pending.length === 0 ? <Text muted>{t('health.dosesNone')}</Text> : null}
            {pending.map((d) => (
              <View key={d.id} style={[styles.card, { backgroundColor: colors.surface }]}>
                <Text variant="bodyStrong">{t('health.dose.line', { title: d.title, dose: d.dose, time: new Date(d.dueAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</Text>
                <View style={styles.row}>
                  <Button label={t('health.dose.taken')} onPress={() => resolve.mutate({ id: d.id, status: 'taken' })} />
                  <Button variant="secondary" label={t('health.dose.skip')} onPress={() => resolve.mutate({ id: d.id, status: 'skip' })} />
                </View>
              </View>
            ))}
            <Button variant="secondary" label={t('health.record')} onPress={() => router.push('/health/record')} />
            <Button variant="secondary" label={t('health.results')} onPress={() => router.push('/health/results')} />
            <Button variant="secondary" label={t('health.reminders')} onPress={() => router.push('/health/reminders')} />
            <Button variant="secondary" label={t('health.directory')} onPress={() => router.push('/health/professionals')} />
            <Button variant="secondary" label={t('health.appointments')} onPress={() => router.push('/health/appointments')} />
            <Button variant="secondary" label={t('health.sharing')} onPress={() => router.push('/health/sharing')} />
            <Button variant="ghost" label={t('health.proSpace')} onPress={() => router.push('/health/pro')} />
            <Button variant="ghost" label={t('health.consent.withdraw')} loading={revoke.isPending} onPress={() => revoke.mutate()} />
            {confirmErase ? (
              <View style={[styles.card, { backgroundColor: colors.surface }]}>
                <Text variant="bodyStrong">{t('health.consent.eraseConfirm')}</Text>
                <Button variant="danger" label={t('health.consent.eraseYes')} loading={erase.isPending} onPress={() => erase.mutate()} />
                <Button variant="ghost" label={t('common.cancel')} onPress={() => setConfirmErase(false)} />
              </View>
            ) : (
              <Button variant="danger" label={t('health.consent.erase')} onPress={() => setConfirmErase(true)} />
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
});
