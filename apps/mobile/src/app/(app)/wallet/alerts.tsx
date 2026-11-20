import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text } from '../../../ui';
import { answerAlert, fetchAlerts, walletFinanceKeys } from '../../../wallet/finance/api';
import { financeErrorMessage } from '../../../wallet/finance/errors';
import { Card, FinanceHeader } from '../../../wallet/finance/ui';

/** Alertes d'activité inhabituelle (mode test) : informatives, aucun envoi n'est jamais bloqué. « C'est moi » ou « Ce n'est pas moi ». */
export default function WalletAlerts() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: walletFinanceKeys.alerts, queryFn: fetchAlerts });
  const answer = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'confirm-mine' | 'report' }) => answerAlert(id, kind),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: walletFinanceKeys.alerts });
    },
    onError: (err) => setError(financeErrorMessage(err, t, locale)),
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('wf.alert.title') }} />
      <View style={{ gap: spacing.lg }}>
        <FinanceHeader />
        <Text muted>{t('wf.alert.hint')}</Text>
        {error ? (
          <Text color={colors.danger} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {list.isPending ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data?.items.length === 0 ? (
          <Text muted>{t('wf.alert.empty')}</Text>
        ) : (
          list.data?.items.map((a) => (
            <Card key={a.id}>
              <Text variant="bodyStrong">{t(`wf.alert.rule.${a.rule}` as const)}</Text>
              <Text variant="caption" muted>
                {t(`wf.alert.severity.${a.severity}` as const)} · {new Date(a.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
              </Text>
              {a.status === 'open' ? (
                <View style={styles.actions}>
                  <Button label={t('wf.alert.mine')} onPress={() => answer.mutate({ id: a.id, kind: 'confirm-mine' })} />
                  <Button
                    variant="secondary"
                    label={t('wf.alert.notMine')}
                    onPress={() =>
                      alertConfirm(t('wf.alert.confirmNotMine'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('wf.alert.notMine'), style: 'destructive', onPress: () => answer.mutate({ id: a.id, kind: 'report' }) }])
                    }
                  />
                </View>
              ) : (
                <Text variant="small" muted>
                  {a.reported ? t('wf.alert.reported') : t('wf.alert.dismissed')}
                </Text>
              )}
            </Card>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
