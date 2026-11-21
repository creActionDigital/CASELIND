import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { useI18n } from '../../../i18n';
import { shareMessage } from '../../../lib/share';
import { QrCode, QrHint } from '../../../scan/QrCode';
import { buildPayRequestQr } from '../../../scan/scan-logic';
import { formatMoney } from '../../../shop/format';
import { Chip } from '../../../shop/parts';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../ui';
import { parseWalletAmount } from '../../../wallet/amount';
import { SandboxBanner } from '../../../wallet/ui';

/** Générer un QR de paiement : montant et devise choisis, le payeur scanne et arrive sur l'envoi prérempli (PIN demandé là-bas). */
export default function WalletQr() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const [currency, setCurrency] = useState<'USD' | 'CDF'>('USD');
  const [text, setText] = useState('');
  const [shown, setShown] = useState<{ value: string; minor: number; currency: 'USD' | 'CDF' } | null>(null);
  const [error, setError] = useState(false);
  const handle = me?.handle ?? '';

  function generate() {
    const p = parseWalletAmount(text, currency);
    if (!('minor' in p) || !handle) {
      setError(true);
      return;
    }
    setError(false);
    setShown({ value: buildPayRequestQr(handle, p.minor, currency), minor: p.minor, currency });
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mc.qr.title') }} />
      <View style={styles.col}>
        <SandboxBanner />
        {shown ? (
          <>
            <QrCode value={shown.value} size={240} label={t('mc.qr.label', { amount: formatMoney(shown.minor, shown.currency, locale), handle: `@${handle}` })} />
            <Text variant="heading" style={{ textAlign: 'center' }}>
              {formatMoney(shown.minor, shown.currency, locale)}
            </Text>
            <QrHint>{t('mc.qr.hint')}</QrHint>
            <Button variant="secondary" label={t('mc.qr.share')} onPress={() => void shareMessage({ message: shown.value }, t('share.copied'))} />
            <Button variant="ghost" label={t('mc.qr.reset')} onPress={() => setShown(null)} />
          </>
        ) : (
          <>
            <Text variant="bodyStrong">{t('mc.qr.currency')}</Text>
            <View style={styles.row}>
              {(['USD', 'CDF'] as const).map((c) => (
                <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
              ))}
            </View>
            <TextField label={t('mc.qr.amount')} value={text} onChangeText={setText} keyboardType="decimal-pad" maxLength={14} />
            {error ? (
              <Text color={colors.danger} accessibilityLiveRegion="polite">
                {t('mc.qr.invalid')}
              </Text>
            ) : null}
            <Button label={t('mc.qr.generate')} onPress={generate} />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  col: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
});
