import type { ContractType, Job } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchJobs, jobKeys } from '../../../jobs/api';
import { CONTRACT_TYPES, contractKey, salaryLabel } from '../../../jobs/logic';
import { useDebouncedValue } from '../../../search/api';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, IconButton, Text, TextField } from '../../../ui';

/** Offres d'emploi : recherche, type de contrat, liste récente d'abord ; accès au CV et aux candidatures. */
export default function Jobs() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim());
  const [contract, setContract] = useState<ContractType | ''>('');
  const filters = useMemo(() => ({ contractType: contract || undefined, q: q || undefined }), [contract, q]);
  const query = useInfiniteQuery({
    queryKey: jobKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchJobs(filters, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const header = (
    <View style={styles.header}>
      <View style={styles.pad}>
        <TextField label={t('jobs.search')} value={text} onChangeText={setText} returnKeyType="search" autoCapitalize="none" />
      </View>
      <Chips
        options={[{ value: '' as const, label: t('jobs.all') }, ...CONTRACT_TYPES.map((c) => ({ value: c, label: t(contractKey(c)) }))]}
        value={contract}
        onChange={(v) => setContract(v === contract ? '' : v)}
      />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: t('jobs.title'),
          headerRight: () => (
            <View style={styles.actions}>
              <IconButton icon="notifications-outline" label={t('jobs.alerts')} onPress={() => router.push('/jobs/alerts')} />
              <IconButton icon="document-text-outline" label={t('jobs.cv')} onPress={() => router.push('/jobs/cv')} />
              <IconButton icon="calendar-outline" label={t('jobs.interviews')} onPress={() => router.push('/jobs/interviews')} />
              <IconButton icon="paper-plane-outline" label={t('jobs.applications')} onPress={() => router.push('/jobs/applications')} />
            </View>
          ),
        }}
      />
      <PagedList
        query={query}
        keyExtractor={(j: Job) => j.id}
        header={header}
        renderItem={({ item }) => <JobCard job={item} onPress={() => router.push({ pathname: '/jobs/[id]', params: { id: item.id } })} />}
        empty={{ icon: 'briefcase-outline', title: t('jobs.emptyTitle'), body: t('jobs.emptyBody') }}
      />
    </View>
  );
}

function JobCard({ job, onPress }: { job: Job; onPress: () => void }) {
  const { t, locale } = useI18n();
  const salary = salaryLabel(job, locale);
  return (
    <Card onPress={onPress} label={job.title} style={styles.card}>
      <Text variant="bodyStrong" numberOfLines={2}>
        {job.title}
      </Text>
      <Text variant="small" muted numberOfLines={1}>
        {job.org.name} · {job.city}
      </Text>
      <View style={styles.badges}>
        <Badge tone="neutral" label={t(contractKey(job.contractType))} />
        {job.applied ? <Badge tone="neutral" label={t('jobs.applied')} /> : null}
      </View>
      {salary ? <Text variant="small">{salary}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.lg },
  actions: { flexDirection: 'row' },
  card: { gap: spacing.xs },
  badges: { flexDirection: 'row', gap: spacing.xs },
});
