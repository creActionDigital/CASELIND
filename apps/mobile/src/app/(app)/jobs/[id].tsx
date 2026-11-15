import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { applyToJob, fetchJob, jobKeys } from '../../../jobs/api';
import { contractKey, salaryLabel } from '../../../jobs/logic';
import { openReport } from '../../../report/open-report';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Fiche d'offre : description, contrat, salaire ; candidature avec le CV enregistré ; signalement. */
export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsCv, setNeedsCv] = useState(false);
  const q = useQuery({ queryKey: jobKeys.one(String(id)), queryFn: () => fetchJob(String(id)) });

  const apply = useMutation({
    mutationFn: () => applyToJob(String(id), message.trim()),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: jobKeys.all });
    },
    onError: (e) => {
      const reason = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      setNeedsCv(reason === 'profile_required');
      if (reason === 'profile_required') return setError(t('jobs.cvNeeded'));
      if (reason === 'already_applied') return setError(t('jobs.err.already'));
      if (e instanceof ApiRequestError && e.status === 403) return setError(t('jobs.err.ownOrg'));
      setError(errorMessage(e, t, locale));
    },
  });

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
  const j = q.data;
  const salary = salaryLabel(j, locale);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('jobs.title') }} />
      <View style={styles.body}>
        <Text variant="title" accessibilityRole="header">
          {j.title}
        </Text>
        <Text muted>
          {j.org.name} · {j.city}
        </Text>
        <View style={styles.badges}>
          <Badge tone="neutral" label={t(contractKey(j.contractType))} />
          {j.org.verified ? <Badge tone="neutral" label={t('jobs.verified')} /> : null}
        </View>
        {salary ? <Text variant="heading">{salary}</Text> : null}
        {j.description ? <Text>{j.description}</Text> : null}
        {j.applied || apply.isSuccess ? (
          <View style={[styles.note, { backgroundColor: colors.surface }]}>
            <Text variant="bodyStrong">{t('jobs.applied')}</Text>
          </View>
        ) : (
          <>
            <TextField label={t('jobs.messageLabel')} value={message} onChangeText={setMessage} multiline maxLength={2000} />
            {error ? (
              <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <Button label={t('jobs.apply')} loading={apply.isPending} onPress={() => apply.mutate()} />
            {needsCv ? <Button variant="secondary" label={t('jobs.cv')} onPress={() => router.push('/jobs/cv')} /> : null}
          </>
        )}
        <Button variant="ghost" label={t('jobs.report')} onPress={() => openReport({ targetType: 'job', targetId: j.id })} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  badges: { flexDirection: 'row', gap: spacing.xs },
  note: { borderRadius: radius.md, padding: spacing.md },
});
