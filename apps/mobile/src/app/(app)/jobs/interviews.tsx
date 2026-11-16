import type { Interview } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { answerInterview, fetchMyInterviews, jobKeys } from '../../../jobs/api';
import { interviewStatusKey } from '../../../jobs/logic';
import { Card } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Text, TextField } from '../../../ui';

/** Mes entretiens : confirmer, refuser (motif facultatif) ou annuler un entretien confirmé (1 h avant au plus tard). Pas de lien visio. */
export default function MyInterviews() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const query = useQuery({ queryKey: jobKeys.interviews, queryFn: fetchMyInterviews });
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'confirm' | 'decline' | 'cancel' }) => answerInterview(v.id, v.action, reason),
    onSuccess: () => {
      setError(null);
      setDeclining(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: jobKeys.interviews });
    },
    onError: (e) => {
      const r = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      setError(r === 'too_late' ? t('jobs.err.tooLate') : r === 'invalid_state' || r === 'interview_past' ? t('jobs.err.interviewState') : errorMessage(e, t, locale));
      void qc.invalidateQueries({ queryKey: jobKeys.interviews });
    },
  });
  const busy = (id: string, a: string) => act.isPending && act.variables?.id === id && act.variables.action === a;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('jobs.interviews') }} />
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      <FlatList
        data={query.data?.items ?? []}
        keyExtractor={(i: Interview) => i.id}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        ListEmptyComponent={
          query.isLoading ? undefined : (
            <Text muted style={styles.error}>
              {t('jobs.interviews.empty')}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <View style={styles.row}>
              <Text variant="bodyStrong" numberOfLines={2} style={styles.flex}>
                {item.job.title}
              </Text>
              <Badge tone={item.status === 'confirmed' ? 'primary' : 'neutral'} label={t(interviewStatusKey(item.status))} />
            </View>
            <Text variant="small" muted>
              {item.job.orgName}
            </Text>
            <Text>
              {new Date(item.startsAt).toLocaleString(locale)} · {t('jobs.interview.duration', { min: item.durationMin })}
            </Text>
            {item.location ? <Text variant="small">{item.location}</Text> : null}
            {item.status === 'proposed' ? (
              <View style={styles.actions}>
                <Button label={t('jobs.interview.confirm')} loading={busy(item.id, 'confirm')} onPress={() => act.mutate({ id: item.id, action: 'confirm' })} />
                {declining === item.id ? (
                  <>
                    <TextField label={t('jobs.interview.reason')} value={reason} onChangeText={setReason} maxLength={200} />
                    <Button variant="danger" label={t('jobs.interview.decline')} loading={busy(item.id, 'decline')} onPress={() => act.mutate({ id: item.id, action: 'decline' })} />
                  </>
                ) : (
                  <Button variant="secondary" label={t('jobs.interview.decline')} onPress={() => setDeclining(item.id)} />
                )}
              </View>
            ) : null}
            {item.status === 'confirmed' ? (
              <Button variant="ghost" label={t('jobs.interview.cancel')} loading={busy(item.id, 'cancel')} onPress={() => act.mutate({ id: item.id, action: 'cancel' })} />
            ) : null}
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  error: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  actions: { gap: spacing.xs, marginTop: spacing.sm },
});
