import type { Application } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { fetchMyApplications, jobKeys, withdrawApplication } from '../../../jobs/api';
import { canWithdraw, statusKey } from '../../../jobs/logic';
import { Card, PagedList } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text } from '../../../ui';
import { useState } from 'react';

/** Mes candidatures et leur statut ; retrait tant que rien n'est décidé. */
export default function MyApplications() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: jobKeys.mine,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchMyApplications(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawApplication(id),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: jobKeys.all });
    },
    onError: (e) => setError(e instanceof ApiRequestError && e.detail<string>('reason') === 'application_final' ? t('jobs.err.final') : errorMessage(e, t, locale)),
  });

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('jobs.applications') }} />
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <PagedList
        query={query}
        keyExtractor={(a: Application) => a.id}
        renderItem={({ item }) => (
          // Retirer reste hors de la carte cliquable : pas de bouton dans un bouton (HTML invalide sur le web).
          <View>
            <Card onPress={() => router.push({ pathname: '/jobs/[id]', params: { id: item.job.id } })} label={item.job.title} style={styles.card}>
              <Text variant="bodyStrong" numberOfLines={2}>
                {item.job.title}
              </Text>
              <Text variant="small" muted>
                {item.job.orgName}
              </Text>
              <View style={styles.row}>
                <Badge tone="neutral" label={t(statusKey(item.status))} />
              </View>
            </Card>
            {canWithdraw(item.status) ? <Button variant="ghost" label={t('jobs.withdraw')} loading={withdraw.isPending && withdraw.variables === item.id} onPress={() => withdraw.mutate(item.id)} /> : null}
          </View>
        )}
        empty={{ icon: 'paper-plane-outline', title: t('jobs.applicationsEmpty') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  error: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  card: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
