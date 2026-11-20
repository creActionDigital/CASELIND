import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useState } from 'react';
import { useAuth } from '../../../auth/auth-context';
import { fetchAnalytics, opsKeys } from '../../../admin-ops/api';
import { BarChart } from '../../../admin-ops/BarChart';
import { amountPoints, PERIODS, type Period } from '../../../admin-ops/logic';
import { useI18n } from '../../../i18n';
import { Card, Chips, Loading, SectionTitle } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { Button, EmptyState, ErrorState, Screen, Text } from '../../../ui';

/** Une valeur lue comme « étiquette : valeur » par les lecteurs d'écran. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label} : ${value}`} style={styles.stat}>
      <Text variant="title">{value}</Text>
      <Text variant="small" muted>{label}</Text>
    </View>
  );
}

/** Analytique de la plateforme (CDC §26) : agrégats uniquement, aucune donnée personnelle. Réservé aux administrateurs. */
export default function AdminAnalytics() {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const isAdmin = me?.roles.includes('admin') ?? false;
  const [days, setDays] = useState<Period>(30);
  const q = useQuery({ queryKey: opsKeys.analytics(days), queryFn: () => fetchAnalytics(days), enabled: isAdmin });
  if (!isAdmin) return <EmptyState icon="lock-closed-outline" title={t('aops.denied')} />;
  const d = q.data;
  const nf = (n: number) => new Intl.NumberFormat(locale).format(n);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('aops.analytics.title') }} />
      <Text variant="small" muted>{t('aops.analytics.intro')}</Text>
      <Chips<string>
        value={String(days)}
        onChange={(v) => setDays(Number(v) as Period)}
        options={PERIODS.map((p) => ({ value: String(p), label: t('aops.analytics.days', { n: p }) }))}
      />
      <Button variant="ghost" label={t('aops.analytics.refresh')} loading={q.isFetching && !q.isPending} onPress={() => void q.refetch()} />
      {q.isPending ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d ? (
        <>
          <SectionTitle>{t('aops.analytics.users')}</SectionTitle>
          <Card style={styles.card}>
            <View style={styles.row}>
              <Stat label={t('aops.analytics.total')} value={nf(d.users.total)} />
              <Stat label={t('aops.analytics.new')} value={nf(d.users.newInPeriod)} />
            </View>
            <Text variant="small" muted>
              {t('aops.analytics.retention')} : {d.users.retentionD7.ratePercent === null
                ? t('aops.analytics.retentionNone')
                : t('aops.analytics.retentionValue', { rate: d.users.retentionD7.ratePercent, retained: d.users.retentionD7.retained, cohort: d.users.retentionD7.cohort })}
            </Text>
            <BarChart title={t('aops.analytics.new')} points={d.users.newByDay} />
            <BarChart title={t('aops.analytics.active')} points={d.users.activeByDay} />
          </Card>

          <SectionTitle>{t('aops.analytics.orgs')}</SectionTitle>
          <Card style={styles.card}>
            <View style={styles.row}>
              <Stat label={t('aops.analytics.total')} value={nf(d.organizations.total)} />
              <Stat label={t('aops.analytics.orgsVerified')} value={nf(d.organizations.verified)} />
              <Stat label={t('aops.analytics.orgsSuspended')} value={nf(d.organizations.suspended)} />
            </View>
          </Card>

          {([['orders', d.orders.byCurrency], ['pos', d.pos.byCurrency]] as const).map(([key, series]) => (
            <View key={key}>
              <SectionTitle>{t(`aops.analytics.${key}`)}</SectionTitle>
              {series.length === 0 ? <Text variant="small" muted>{t('aops.analytics.noSales')}</Text> : series.map((c) => (
                <Card key={c.currency} style={styles.card}>
                  <View style={styles.row}>
                    <Stat label={`${t('aops.analytics.revenue')} (${c.currency})`} value={formatMoney(c.amountMinor, c.currency, locale)} />
                    <Stat label={t('aops.analytics.count')} value={nf(c.count)} />
                    <Stat label={t('aops.analytics.basket')} value={formatMoney(c.averageMinor, c.currency, locale)} />
                  </View>
                  <BarChart title={`${t('aops.analytics.revenue')} (${c.currency})`} points={amountPoints(c.byDay)} format={(n) => formatMoney(Math.round(n), c.currency, locale)} />
                </Card>
              ))}
            </View>
          ))}

          <SectionTitle>{t('aops.analytics.messages')}</SectionTitle>
          <Card style={styles.card}><BarChart title={t('aops.analytics.messages')} points={d.messages.byDay} /></Card>

          <SectionTitle>{t('aops.analytics.posts')}</SectionTitle>
          <Card style={styles.card}><BarChart title={t('aops.analytics.posts')} points={d.posts.byDay} /></Card>

          <SectionTitle>{t('aops.analytics.reports')}</SectionTitle>
          <Card style={styles.card}>
            <View style={styles.row}>
              <Stat label={t('aops.analytics.reportsOpen')} value={nf(d.reports.open)} />
              <Stat label={t('aops.analytics.reportsCreated')} value={nf(d.reports.createdInPeriod)} />
              <Stat label={t('aops.analytics.reportsResolved')} value={nf(d.reports.resolvedInPeriod)} />
            </View>
          </Card>

          <SectionTitle>{t('aops.analytics.ai')}</SectionTitle>
          <Card style={styles.card}>
            <Stat label={t('aops.analytics.count')} value={nf(d.ai.requests)} />
            <BarChart title={t('aops.analytics.ai')} points={d.ai.byDay} />
          </Card>

          {d.topOrganizations.map((c) => (
            <View key={c.currency}>
              <SectionTitle>{`${t('aops.analytics.top')} (${c.currency})`}</SectionTitle>
              <Card style={styles.card}>
                {c.items.map((o, i) => (
                  <Text key={o.organizationId} variant="body">
                    {i + 1}. {t('aops.analytics.topRow', { name: o.name, amount: formatMoney(o.amountMinor, c.currency, locale), orders: o.orders })}
                  </Text>
                ))}
              </Card>
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  stat: { minWidth: 96 },
});
