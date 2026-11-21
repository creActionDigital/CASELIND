import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { bk, fetchExportCsv, fetchProfitability } from '../../../../business/api';
import { businessErrorMessage } from '../../../../business/errors';
import { barWidths, exportFileName, marginPercent, PERIOD_PRESETS, periodFor, type PeriodPreset } from '../../../../business/logic';
import { useI18n, type MessageKey } from '../../../../i18n';
import { shareMessage } from '../../../../lib/share';
import { useMembership } from '../../../../seller/api';
import { formatMinor } from '../../../../seller/money';
import { can } from '../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text } from '../../../../ui';

type Kind = 'sales' | 'expenses' | 'purchases';

/** « Rentabilité » (`finance.view`) : chiffre d'affaires, marge brute, dépenses et résultat estimé d'une période, par devise ; exports CSV. */
export default function SellerProfitability() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const allowed = can(role, 'finance.view');
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [busy, setBusy] = useState<Kind | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { from, to } = periodFor(preset, new Date());
  const q = useQuery({ queryKey: bk.profit(orgId, from, to), queryFn: () => fetchProfitability(orgId, from, to), enabled: allowed });

  const title = <Stack.Screen options={{ title: t('biz.profit.title') }} />;
  if (isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('biz.profit.forbidden')}</Text></Screen></>;

  /** Le fichier est préparé par le serveur puis partagé avec la feuille de partage du système (e-mail, tableur, enregistrer…). */
  const exportCsv = async (kind: Kind) => {
    setBusy(kind);
    setInfo(null);
    try {
      const csv = await fetchExportCsv(orgId, kind, from, to);
      await shareMessage({ title: exportFileName(kind, from, to), message: csv }, t('share.copied'));
    } catch (e) {
      setInfo(e instanceof Error && e.name === 'AbortError' ? null : businessErrorMessage(e, t, locale));
    } finally {
      setBusy(null);
    }
  };

  const money = (minor: number, cur: string) => formatMinor(minor, cur, locale);

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Chips options={PERIOD_PRESETS.map((p) => ({ value: p, label: t(`biz.period.${p}` as MessageKey) }))} value={preset} onChange={setPreset} />
          <Text variant="small" muted>{`${from} → ${to}`}</Text>
          {q.isPending ? <Loading /> : null}
          {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
          {q.data && q.data.currencies.length === 0 ? <Text muted>{t('biz.profit.empty')}</Text> : null}
          {q.data?.currencies.map((c) => {
            const pct = marginPercent(c.grossMarginMinor, c.revenueMinor);
            const widths = barWidths(c.expensesByCategory.map((e) => e.amountMinor));
            return (
              <Card key={c.currency}>
                <Text variant="heading">{c.currency}</Text>
                <Row label={t('biz.profit.revenue')} value={money(c.revenueMinor, c.currency)} strong />
                <Row label={t('biz.profit.orders')} value={money(c.ordersRevenueMinor, c.currency)} muted />
                <Row label={t('biz.profit.pos')} value={money(c.posRevenueMinor, c.currency)} muted />
                <Row label={t('biz.profit.cogs')} value={money(c.cogsMinor, c.currency)} />
                <Row label={t('biz.profit.gross')} value={money(c.grossMarginMinor, c.currency)} strong />
                {pct !== null ? <Text variant="small" muted>{t('biz.profit.margin', { pct: String(pct).replace('.', locale.startsWith('fr') ? ',' : '.') })}</Text> : null}
                <Row label={t('biz.profit.expenses')} value={money(c.expensesMinor, c.currency)} />
                <Row label={t('biz.profit.result')} value={money(c.estimatedResultMinor, c.currency)} strong danger={c.estimatedResultMinor < 0} />
                {c.unknownCostLines > 0 ? (
                  <Text variant="small" color={colors.danger}>{t('biz.profit.unknown', { n: c.unknownCostLines, amount: money(c.unknownCostRevenueMinor, c.currency) })}</Text>
                ) : null}

                {c.expensesByCategory.length > 0 ? <SectionTitle>{t('biz.profit.byCategory')}</SectionTitle> : null}
                {c.expensesByCategory.map((e, i) => (
                  <View key={e.category} style={{ gap: 2 }} accessible accessibilityLabel={`${t(`biz.cat.${e.category}` as MessageKey)} ${money(e.amountMinor, c.currency)}`}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text variant="small">{t(`biz.cat.${e.category}` as MessageKey)}</Text>
                      <Text variant="small">{money(e.amountMinor, c.currency)}</Text>
                    </View>
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt }}>
                      <View style={{ height: 8, borderRadius: 4, width: `${widths[i] ?? 0}%`, backgroundColor: colors.primary }} />
                    </View>
                  </View>
                ))}

                {c.topProducts.length > 0 ? <SectionTitle>{t('biz.profit.top')}</SectionTitle> : null}
                {c.topProducts.map((p) => (
                  <View key={p.productId} style={{ gap: 2 }}>
                    <Text numberOfLines={1}>{p.title}</Text>
                    <Text variant="small" muted>{t('biz.profit.topLine', { n: p.quantity, margin: money(p.marginMinor, c.currency) })}</Text>
                  </View>
                ))}
              </Card>
            );
          })}
          <Text variant="small" muted>{t('biz.profit.note')}</Text>

          <SectionTitle>{t('biz.profit.export')}</SectionTitle>
          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {(['sales', 'expenses', 'purchases'] as const).map((k) => (
              <Button
                key={k}
                variant="secondary"
                label={t(`biz.profit.export${k === 'sales' ? 'Sales' : k === 'expenses' ? 'Expenses' : 'Purchases'}` as MessageKey)}
                loading={busy === k}
                disabled={busy !== null}
                onPress={() => void exportCsv(k)}
              />
            ))}
          </View>
        </View>
      </Screen>
    </>
  );
}

function Row({ label, value, strong, muted, danger }: { label: string; value: string; strong?: boolean; muted?: boolean; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text style={{ flex: 1 }} variant={muted ? 'small' : 'body'} muted={muted} numberOfLines={2}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : muted ? 'small' : 'body'} muted={muted} color={danger ? colors.danger : undefined}>
        {value}
      </Text>
    </View>
  );
}
