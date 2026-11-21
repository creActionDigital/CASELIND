import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fetchCampaignStats } from '../../../ads/api';
import { CampaignActions } from '../../../ads/CampaignActions';
import { ctrPercent } from '../../../ads/logic';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Loading } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, ErrorState, Text } from '../../../ui';

/** Statistiques d'une campagne : impressions, clics, dépense, remboursement et détail par jour. */
export default function CampaignStats() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['ad-stats', id], queryFn: () => fetchCampaignStats(id), enabled: !!id });
  const c = q.data?.campaign;
  const money = (m: number) => formatMoney(m, c!.currency, locale);
  const cell = (label: string, value: string) => (
    <View key={label} accessible accessibilityLabel={`${label} : ${value}`} style={[styles.cell, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="title">{value}</Text>
      <Text variant="caption" muted>
        {label}
      </Text>
    </View>
  );
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Stack.Screen options={{ title: t('mon.ads.detail.title') }} />
      {q.isPending ? <Loading /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {c ? (
        <>
          <View style={styles.between}>
            <Text variant="heading" style={{ flex: 1 }}>
              {c.name}
            </Text>
            <Badge label={t(`mon.ads.status.${c.status}` as MessageKey)} tone={c.status === 'approved' ? 'primary' : 'neutral'} />
          </View>
          {c.rejectionReason ? <Text color={colors.danger}>{t('mon.ads.reason', { reason: c.rejectionReason })}</Text> : null}
          <View style={styles.grid}>
            {cell(t('mon.ads.detail.impressions'), String(c.impressions))}
            {cell(t('mon.ads.detail.clicks'), String(c.clicks))}
            {cell(t('mon.ads.detail.spent'), money(c.spentMinor))}
            {cell(t('mon.ads.detail.refunded'), money(c.refundedMinor))}
          </View>
          <Text muted>{t('mon.ads.detail.ctr', { pct: ctrPercent(c.impressions, c.clicks) })}</Text>
          <Text variant="heading" accessibilityRole="header">
            {t('mon.ads.detail.days')}
          </Text>
          {(q.data?.days.length ?? 0) === 0 ? <Text muted>{t('mon.ads.detail.noDays')}</Text> : null}
          {(q.data?.days ?? []).map((d) => (
            <Card key={d.date} style={styles.between}>
              <Text>{d.date}</Text>
              <Text variant="small" muted>
                {t('mon.ads.stats', { imp: d.impressions, clicks: d.clicks })} · {money(d.spentMinor)}
              </Text>
            </Card>
          ))}
          <CampaignActions campaign={c} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: { flexGrow: 1, flexBasis: '45%', borderWidth: 1, borderRadius: 12, padding: spacing.md },
});
