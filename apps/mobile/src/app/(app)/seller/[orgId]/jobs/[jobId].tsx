import type { OrgApplication } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { ApiRequestError } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { fetchOrgApplications, jobKeys, setApplicationStatus } from '../../../../../jobs/api';
import { nextStatuses, statusKey, type RecruiterStatus } from '../../../../../jobs/logic';
import { Card, PagedList } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, Text } from '../../../../../ui';

/** Candidatures d'une offre : CV tel qu'envoyé, message, passage d'un statut à l'autre. */
export default function OrgApplications() {
  const { orgId, jobId } = useLocalSearchParams<{ orgId: string; jobId: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const key = jobKeys.orgApps(String(orgId), String(jobId));
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchOrgApplications(String(orgId), String(jobId), pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const move = useMutation({
    mutationFn: (v: { id: string; status: RecruiterStatus }) => setApplicationStatus(String(orgId), v.id, v.status),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => {
      const reason = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      setError(reason === 'invalid_transition' ? t('jobs.err.transition') : errorMessage(e, t, locale));
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('jobs.org.applicants') }} />
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <PagedList
        query={query}
        keyExtractor={(a: OrgApplication) => a.id}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <View style={styles.row}>
              <Text variant="bodyStrong">{item.applicant.displayName}</Text>
              <Badge tone="neutral" label={t(statusKey(item.status))} />
            </View>
            <Text variant="small" muted>
              @{item.applicant.handle} · {item.cv.headline}
            </Text>
            {item.cv.skills.length > 0 ? <Text variant="small">{item.cv.skills.join(' · ')}</Text> : null}
            {item.cv.experience ? <Text variant="small">{item.cv.experience}</Text> : null}
            {item.cv.education ? <Text variant="small">{item.cv.education}</Text> : null}
            {item.message ? <Text>{item.message}</Text> : null}
            <View style={styles.actions}>
              {nextStatuses(item.status).map((s) => (
                <Button
                  key={s}
                  variant={s === 'rejected' ? 'danger' : 'secondary'}
                  label={t('jobs.org.setStatus', { status: t(statusKey(s)) })}
                  loading={move.isPending && move.variables?.id === item.id && move.variables.status === s}
                  onPress={() => move.mutate({ id: item.id, status: s })}
                />
              ))}
            </View>
          </Card>
        )}
        empty={{ icon: 'people-outline', title: t('jobs.org.noApplicants') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  error: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { gap: spacing.xs, marginTop: spacing.sm },
});
