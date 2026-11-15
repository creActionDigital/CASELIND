import type { Contract, Mission, Proposal } from '@caselind/contracts';
import { useInfiniteQuery, type UseInfiniteQueryResult, type InfiniteData } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchContracts, fetchMyMissions, fetchMyProposals, frKeys } from '../../../freelance/api';
import { contractStatusKey, proposalStatusKey } from '../../../freelance/logic';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Text } from '../../../ui';

type Tab = 'missions' | 'proposals' | 'contracts';

/** Mon activité : mes missions (client), mes propositions et mes contrats (client ou freelance). */
export default function MyFreelance() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('contracts');
  const next = <T extends { nextCursor: string | null }>(last: T) => last.nextCursor ?? undefined;
  const missions = useInfiniteQuery({ queryKey: frKeys.myMissions, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => fetchMyMissions(pageParam), getNextPageParam: next });
  const proposals = useInfiniteQuery({ queryKey: frKeys.myProposals, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => fetchMyProposals(pageParam), getNextPageParam: next });
  const contracts = useInfiniteQuery({ queryKey: frKeys.contracts, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => fetchContracts(pageParam), getNextPageParam: next });

  const tabs = (
    <View style={styles.tabs}>
      <Chips
        options={(['contracts', 'proposals', 'missions'] as const).map((k) => ({ value: k, label: t(`freelance.tab.${k}`) }))}
        value={tab}
        onChange={setTab}
      />
    </View>
  );
  const common = { header: tabs } as const;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('freelance.mine') }} />
      {tab === 'missions' ? (
        <PagedList
          {...common}
          query={missions as UseInfiniteQueryResult<InfiniteData<{ items: Mission[]; nextCursor: string | null }>>}
          keyExtractor={(m: Mission) => m.id}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/freelance/[id]', params: { id: item.id } })} label={item.title} style={styles.card}>
              <Text variant="bodyStrong">{item.title}</Text>
              <Text variant="small" muted>
                {formatMoney(item.budgetMinor, item.currency, locale)} · {t(`freelance.mission.${item.status}`)}
              </Text>
            </Card>
          )}
          empty={{ icon: 'hammer-outline', title: t('freelance.emptyTitle') }}
        />
      ) : tab === 'proposals' ? (
        <PagedList
          {...common}
          query={proposals as UseInfiniteQueryResult<InfiniteData<{ items: Proposal[]; nextCursor: string | null }>>}
          keyExtractor={(p: Proposal) => p.id}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/freelance/[id]', params: { id: item.missionId } })} label={item.missionTitle} style={styles.card}>
              <Text variant="bodyStrong">{item.missionTitle}</Text>
              <Text variant="small" muted>
                {t('freelance.proposalLine', { amount: formatMoney(item.amountMinor, item.currency, locale), days: item.deliveryDays })}
              </Text>
              <Badge tone="neutral" label={t(proposalStatusKey(item.status))} />
            </Card>
          )}
          empty={{ icon: 'paper-plane-outline', title: t('freelance.emptyTitle') }}
        />
      ) : (
        <PagedList
          {...common}
          query={contracts as UseInfiniteQueryResult<InfiniteData<{ items: Contract[]; nextCursor: string | null }>>}
          keyExtractor={(c: Contract) => c.id}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/freelance/contract/[id]', params: { id: item.id } })} label={item.missionTitle} style={styles.card}>
              <Text variant="bodyStrong">{item.missionTitle}</Text>
              <Text variant="small" muted>
                {formatMoney(item.amountMinor, item.currency, locale)}
              </Text>
              <Badge tone="neutral" label={t(contractStatusKey(item.status))} />
            </Card>
          )}
          empty={{ icon: 'document-text-outline', title: t('freelance.contract.empty') }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabs: { paddingTop: spacing.sm },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
});
