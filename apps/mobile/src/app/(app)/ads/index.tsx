import type { AdCampaign, AdStatus } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fetchCampaigns } from '../../../ads/api';
import { CampaignActions } from '../../../ads/CampaignActions';
import { AD_STATUSES } from '../../../ads/logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text } from '../../../ui';
import { SandboxBanner } from '../../../wallet/ui';

type Filter = AdStatus | 'all';

function CampaignCard({ c }: { c: AdCampaign }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Card onPress={() => router.push({ pathname: '/ads/[id]', params: { id: c.id } })} label={c.name} style={{ gap: spacing.sm }}>
      <View style={styles.between}>
        <Text style={{ fontWeight: '700', flex: 1 }}>{c.name}</Text>
        <Badge tone={c.status === 'approved' ? 'primary' : c.status === 'pending' ? 'accent' : 'neutral'} label={t(`mon.ads.status.${c.status}` as MessageKey)} />
      </View>
      <Text variant="small" muted>
        {t('mon.ads.budget', { spent: formatMoney(c.spentMinor, c.currency, locale), budget: formatMoney(c.budgetMinor, c.currency, locale) })}
      </Text>
      <Text variant="small" muted>
        {t('mon.ads.stats', { imp: c.impressions, clicks: c.clicks })}
      </Text>
      {c.rejectionReason ? (
        <Text variant="small" color={colors.danger}>
          {t('mon.ads.reason', { reason: c.rejectionReason })}
        </Text>
      ) : null}
      <CampaignActions campaign={c} />
    </Card>
  );
}

/** Centre publicitaire : mes campagnes, leur état, pause / reprise / arrêt. Paiement en mode test. */
export default function AdsCenter() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const query = useInfiniteQuery({
    queryKey: ['ad-campaigns', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchCampaigns(filter === 'all' ? undefined : filter, pageParam),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('mon.ads.title') }} />
      <PagedList
        query={query}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <CampaignCard c={item} />}
        empty={{ icon: 'megaphone-outline', title: t('mon.ads.empty'), body: t('mon.ads.emptyBody'), actionLabel: t('mon.ads.new'), onAction: () => router.push('/ads/new') }}
        header={
          <View style={styles.head}>
            <SandboxBanner />
            <Text muted>{t('mon.ads.lead')}</Text>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Button label={t('mon.ads.new')} onPress={() => router.push('/ads/new')} />
              </View>
              <Button variant="secondary" label={t('mon.ads.billing')} onPress={() => router.push('/ads/billing')} />
            </View>
            <Chips value={filter} onChange={setFilter} options={[{ value: 'all' as Filter, label: t('mon.ads.filter.all') }, ...AD_STATUSES.map((s) => ({ value: s as Filter, label: t(`mon.ads.status.${s}` as MessageKey) }))]} />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { padding: spacing.lg, paddingBottom: 0, gap: spacing.md },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
});
