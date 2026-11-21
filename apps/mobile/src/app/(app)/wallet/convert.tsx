import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { formatMoney } from '../../../shop/format';
import { Chip } from '../../../shop/parts';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';
import { parseWalletAmount } from '../../../wallet/amount';
import { fetchFxQuote } from '../../../wallet/fx-api';
import { SandboxBanner } from '../../../wallet/ui';

const CURS = ['USD', 'CDF'] as const;

/** Conversion de devises : calcul indicatif (taux serveur), aucun solde converti, jamais de mélange de devises. */
export default function WalletConvert() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [from, setFrom] = useState<'USD' | 'CDF'>('USD');
  const to = from === 'USD' ? 'CDF' : 'USD';
  const [text, setText] = useState('10');
  const [debounced, setDebounced] = useState(text);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), 350);
    return () => clearTimeout(id);
  }, [text]);
  const parsed = parseWalletAmount(debounced, from);
  const minor = 'minor' in parsed ? parsed.minor : null;
  const quote = useQuery({ queryKey: ['fx-quote', from, to, minor], queryFn: () => fetchFxQuote(from, to, minor!), enabled: minor !== null, staleTime: 60_000 });
  const rate = quote.data ? new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(quote.data.rate) : '';
  return (
    <Screen>
      <Stack.Screen options={{ title: t('mc.fx.title') }} />
      <View style={styles.col}>
        <SandboxBanner />
        <Text variant="bodyStrong">{t('mc.fx.from')}</Text>
        <View style={styles.row}>
          {CURS.map((c) => (
            <Chip key={c} label={c} selected={from === c} onPress={() => setFrom(c)} />
          ))}
          <Button variant="ghost" label={t('mc.fx.swap')} onPress={() => setFrom(to)} />
        </View>
        <TextField label={t('mc.fx.amount')} value={text} onChangeText={setText} keyboardType="decimal-pad" maxLength={14} />
        {minor === null ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {t('mc.fx.invalid')}
          </Text>
        ) : quote.isPending ? (
          <Text muted>{t('common.loading')}</Text>
        ) : quote.isError ? (
          <ErrorState error={quote.error} onRetry={() => quote.refetch()} />
        ) : (
          <View accessibilityLiveRegion="polite" style={[styles.result, { backgroundColor: colors.surface }]}>
            <Text variant="bodyStrong">
              {t('mc.fx.to')} {to}
            </Text>
            <Text variant="display" color={colors.primary}>
              {t('mc.fx.result', { amount: formatMoney(quote.data.convertedMinor, to, locale) })}
            </Text>
            <Text variant="small" muted>
              {t('mc.fx.rate', { from, to, rate })}
            </Text>
          </View>
        )}
        <Text variant="small" muted>
          {t('mc.fx.disclaimer')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  col: { gap: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  result: { borderRadius: 20, padding: spacing.lg, gap: spacing.xs },
});
