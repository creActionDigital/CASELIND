import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { uuidv4 } from '../../../lib/uuid';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Text, TextField } from '../../../ui';
import { Chips } from '../../../seller/ui';
import { parseWalletAmount, topupMaxMinor, WALLET_CURRENCIES } from '../../../wallet/amount';
import { sandboxTopup } from '../../../wallet/api';
import { walletKeys } from '../../../wallet/hooks';
import { useWalletPrefs } from '../../../wallet/prefs';
import { SandboxBanner } from '../../../wallet/ui';

/** Recharge de test : crédite de l'argent fictif (plafonné). Le `clientId` est conservé pour les nouvelles tentatives. */
export default function WalletTopup() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const prefs = useWalletPrefs();
  const [currency, setCurrency] = useState<string>(prefs.currency);
  const [amount, setAmount] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const attempt = useRef<{ sig: string; id: string } | null>(null);

  const max = topupMaxMinor(currency);
  const parsed = parseWalletAmount(amount, currency, max);
  const minor = 'minor' in parsed ? parsed.minor : null;
  const maxText = formatMoney(max, currency, locale);

  const topup = useMutation({
    mutationFn: () => {
      const sig = `${minor}|${currency}`;
      if (attempt.current?.sig !== sig) attempt.current = { sig, id: uuidv4() };
      return sandboxTopup({ clientId: attempt.current.id, amountMinor: minor!, currency });
    },
    onSuccess: (res) => {
      attempt.current = null;
      setDone(res.balanceMinor);
      void qc.invalidateQueries({ queryKey: walletKeys.wallet });
      void qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
    },
  });

  const fieldError = !amount || minor !== null ? null : 'issue' in parsed && parsed.issue === 'too_high' ? t('wallet.topup.tooHigh', { max: maxText }) : t('wallet.error.amount');

  return (
    <>
      <Stack.Screen options={{ title: t('wallet.topup.title') }} />
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <SandboxBanner />
        {done !== null ? (
          <>
            <Text variant="title" accessibilityRole="header">
              {t('wallet.topup.doneTitle')}
            </Text>
            <Text muted>{t('wallet.send.newBalance', { amount: formatMoney(done, currency, locale) })}</Text>
            <Button label={t('wallet.send.finish')} onPress={() => router.replace('/wallet')} />
          </>
        ) : (
          <>
            <Text muted>{t('wallet.topup.intro')}</Text>
            <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as 'USD' | 'CDF'} onChange={setCurrency} scroll={false} />
            <TextField
              label={t('wallet.send.amount')}
              value={amount}
              onChangeText={(v) => {
                setAmount(v);
                topup.reset();
              }}
              keyboardType="decimal-pad"
              placeholder="0,00"
              hint={t('wallet.topup.max', { max: maxText })}
              error={fieldError}
            />
            {topup.isError ? (
              <Text variant="small" color={colors.danger} accessibilityRole="alert">
                {errorMessage(topup.error, t, locale)}
              </Text>
            ) : null}
            <Button label={t('wallet.topup.submit')} loading={topup.isPending} disabled={minor === null} onPress={() => topup.mutate()} />
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({ pad: { padding: spacing.lg, gap: spacing.md } });
