import type { ContractType } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { createJobAlert, deleteJobAlert, fetchJobAlerts, jobKeys } from '../../../jobs/api';
import { CONTRACT_TYPES, contractKey } from '../../../jobs/logic';
import { Chips } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Alertes d'emploi : privées, 5 au plus ; une notification quand une nouvelle offre correspond. */
export default function JobAlerts() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: jobKeys.alerts, queryFn: fetchJobAlerts });
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [contract, setContract] = useState<ContractType | ''>('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: jobKeys.alerts });

  const add = useMutation({
    mutationFn: () => createJobAlert({ q: q.trim() || undefined, city: city.trim() || undefined, contractType: contract || undefined }),
    onSuccess: () => {
      setError(null);
      setQ('');
      setCity('');
      setContract('');
      void refresh();
    },
    onError: (e) => setError(e instanceof ApiRequestError && e.status === 409 ? t('jobs.alerts.limit') : errorMessage(e, t, locale)),
  });
  const remove = useMutation({ mutationFn: deleteJobAlert, onSuccess: () => void refresh(), onError: (e) => setError(errorMessage(e, t, locale)) });

  if (list.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (list.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      </Screen>
    );
  }
  const empty = !q.trim() && !city.trim() && !contract;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('jobs.alerts') }} />
      <View style={styles.form}>
        <View style={[styles.note, { backgroundColor: colors.surface }]}>
          <Text variant="small" muted>
            {t('jobs.alerts.intro')}
          </Text>
        </View>
        {list.data.items.length === 0 ? <Text muted>{t('jobs.alerts.empty')}</Text> : null}
        {list.data.items.map((a) => (
          <View key={a.id} style={[styles.row, { backgroundColor: colors.surface }]}>
            <Text style={styles.flex}>{[a.q, a.city, a.contractType ? t(contractKey(a.contractType)) : null].filter(Boolean).join(' · ')}</Text>
            <Button variant="danger" label={t('jobs.alerts.delete')} loading={remove.isPending && remove.variables === a.id} onPress={() => remove.mutate(a.id)} />
          </View>
        ))}
        <TextField label={t('jobs.alerts.q')} value={q} onChangeText={setQ} maxLength={100} autoCapitalize="none" />
        <TextField label={t('jobs.alerts.city')} value={city} onChangeText={setCity} maxLength={80} />
        <Chips
          options={[{ value: '' as const, label: t('jobs.alerts.anyContract') }, ...CONTRACT_TYPES.map((c) => ({ value: c, label: t(contractKey(c)) }))]}
          value={contract}
          onChange={(v) => setContract(v === contract ? '' : v)}
        />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('jobs.alerts.add')} loading={add.isPending} disabled={empty} onPress={() => add.mutate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  note: { borderRadius: radius.md, padding: spacing.md },
  row: { alignItems: 'center', borderRadius: radius.md, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
});
