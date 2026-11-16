import type { Job } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { errorMessage } from '../../../../../lib/errors';
import { closeOrgJob, fetchOrgJobs, jobKeys } from '../../../../../jobs/api';
import { contractKey } from '../../../../../jobs/logic';
import { Card, PagedList } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Badge, Button, IconButton, Text } from '../../../../../ui';
import { useState } from 'react';

/** Recrutement d'une organisation (permission hr.manage) : offres, clôture, accès aux candidatures. */
export default function OrgJobs() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: jobKeys.org(String(orgId)),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchOrgJobs(String(orgId), pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const close = useMutation({
    mutationFn: (jobId: string) => closeOrgJob(String(orgId), jobId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobKeys.org(String(orgId)) }),
    onError: (e) => setError(errorMessage(e, t, locale)),
  });

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: t('jobs.org.title'),
          headerRight: () => <IconButton icon="add-circle-outline" label={t('jobs.org.new')} onPress={() => router.push({ pathname: '/seller/[orgId]/jobs/new', params: { orgId: String(orgId) } })} />,
        }}
      />
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <PagedList
        query={query}
        keyExtractor={(j: Job) => j.id}
        renderItem={({ item }) => (
          <Card
            onPress={() => router.push({ pathname: '/seller/[orgId]/jobs/[jobId]', params: { orgId: String(orgId), jobId: item.id } })}
            label={item.title}
            style={styles.card}
          >
            <Text variant="bodyStrong" numberOfLines={2}>
              {item.title}
            </Text>
            <Text variant="small" muted>
              {t(contractKey(item.contractType))} · {item.city}
            </Text>
            <View style={styles.row}>
              <Badge tone="neutral" label={item.status === 'open' ? t('jobs.org.applicants') : t('jobs.closed')} />
              {item.status === 'open' ? <Button variant="ghost" label={t('jobs.org.editAction')} onPress={() => router.push({ pathname: '/seller/[orgId]/jobs/new', params: { orgId: String(orgId), jobId: item.id } })} /> : null}
              {item.status === 'open' ? <Button variant="ghost" label={t('jobs.org.close')} loading={close.isPending && close.variables === item.id} onPress={() => close.mutate(item.id)} /> : null}
            </View>
          </Card>
        )}
        empty={{ icon: 'briefcase-outline', title: t('jobs.org.empty'), actionLabel: t('jobs.org.new'), onAction: () => router.push({ pathname: '/seller/[orgId]/jobs/new', params: { orgId: String(orgId) } }) }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  error: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
