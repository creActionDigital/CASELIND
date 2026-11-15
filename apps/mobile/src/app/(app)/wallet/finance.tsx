import type { FinanceCurrencySummary } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { formatMoney } from '../../../shop/format';
import { brandColor, radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';
import { parseWalletAmount } from '../../../wallet/amount';
import { fetchFinanceSummary, removeBudget, setBudget } from '../../../wallet/finance-api';
import { SandboxBanner } from '../../../wallet/ui';

/** Finances perso : dépenses du mois et budget mensuel par devise, calculés sur le wallet de test. */
export default function WalletFinance() {
  const { t } = useI18n();
  const summary = useQuery({ queryKey: ['finance-summary'], queryFn: () => fetchFinanceSummary() });
  return (
    <Screen>
      <Stack.Screen options={{ title: t('wallet.finance.title') }} />
      <View style={{ gap: spacing.lg }}>
        <SandboxBanner />
        {summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        ) : summary.data?.items.length === 0 ? (
          <Text muted>{t('wallet.finance.empty')}</Text>
        ) : (
          summary.data?.items.map((s) => <CurrencyCard key={s.currency} s={s} />)
        )}
      </View>
    </Screen>
  );
}

function CurrencyCard({ s }: { s: FinanceCurrencySummary }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, s.currency, locale);
  const done = () => {
    setError(null);
    setInput('');
    void qc.invalidateQueries({ queryKey: ['finance-summary'] });
  };
  const save = useMutation({
    mutationFn: (limitMinor: number) => setBudget({ currency: s.currency, limitMinor }),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e, t, locale)),
  });
  const remove = useMutation({ mutationFn: () => removeBudget(s.currency), onSuccess: done, onError: (e) => setError(errorMessage(e, t, locale)) });
  const over = s.remainingMinor !== null && s.remainingMinor < 0;
  const pct = Math.min(100, s.usedPercent ?? 0);

  function submit() {
    const parsed = parseWalletAmount(input, s.currency);
    if ('issue' in parsed || parsed.minor <= 0) return setError(t('wallet.finance.invalid'));
    save.mutate(parsed.minor);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <Text variant="bodyStrong">{s.currency}</Text>
      <Text variant="title">{money(s.spentMinor)}</Text>
      <Text variant="small" muted>
        {t('wallet.finance.spent')} · {t('wallet.finance.received', { amount: money(s.receivedMinor) })}
      </Text>
      {s.budgetMinor !== null ? (
        <View style={{ gap: spacing.xs }}>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: pct }}
            style={[styles.track, { backgroundColor: colors.border }]}
          >
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: over ? colors.danger : brandColor }]} />
          </View>
          <Text variant="small" color={over ? colors.danger : undefined}>
            {over
              ? t('wallet.finance.over', { amount: money(-(s.remainingMinor ?? 0)), budget: money(s.budgetMinor) })
              : t('wallet.finance.left', { amount: money(s.remainingMinor ?? 0), budget: money(s.budgetMinor) })}
          </Text>
        </View>
      ) : null}
      {s.byKind.map((k) => (
        <View key={k.kind} style={styles.row}>
          <Text>{t(k.kind === 'p2p' ? 'wallet.finance.kind.p2p' : 'wallet.finance.kind.merchant_payment')}</Text>
          <Text>{money(k.spentMinor)}</Text>
        </View>
      ))}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <TextField label={t('wallet.finance.budgetLabel')} value={input} onChangeText={setInput} keyboardType="decimal-pad" onSubmitEditing={submit} />
      <Button label={t('common.save')} loading={save.isPending} disabled={!input.trim()} onPress={submit} />
      {s.budgetMinor !== null ? <Button variant="ghost" label={t('wallet.finance.remove')} loading={remove.isPending} onPress={() => remove.mutate()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
});
