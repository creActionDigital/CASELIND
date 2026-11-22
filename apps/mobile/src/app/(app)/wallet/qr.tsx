import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { useI18n } from '../../../i18n';
import { shareMessage } from '../../../lib/share';
import { QrCode, QrHint } from '../../../scan/QrCode';
import { buildPayRequestQr, buildProfileQr } from '../../../scan/scan-logic';
import { formatMoney } from '../../../shop/format';
import { Chip } from '../../../shop/parts';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../ui';
import { parseWalletAmount } from '../../../wallet/amount';
import { useWallet } from '../../../wallet/hooks';
import { setWalletPrefs, useWalletPrefs } from '../../../wallet/prefs';
import { SandboxBanner } from '../../../wallet/ui';

/** Mon QR code : affiché d'emblée sans montant (le payeur le saisit), ou avec montant via « Ajouter un montant » (PIN demandé côté payeur). */
export default function WalletQr() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const prefs = useWalletPrefs();
  const wallet = useWallet();
  const [currency, setCurrency] = useState<'USD' | 'CDF'>('USD');
  const [text, setText] = useState('');
  const [shown, setShown] = useState<{ value: string; minor: number; currency: 'USD' | 'CDF' } | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(false);
  const handle = me?.handle ?? '';
  const balance = wallet.data?.balances.find((b) => b.currency === prefs.currency)?.balanceMinor ?? 0;

  function generate() {
    const p = parseWalletAmount(text, currency);
    if (!('minor' in p) || !handle) {
      setError(true);
      return;
    }
    setError(false);
    setShown({ value: buildPayRequestQr(handle, p.minor, currency), minor: p.minor, currency });
    setAdding(false);
  }

  const value = shown?.value ?? (handle ? buildProfileQr(handle) : '');

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mc.qr.mine') }} />
      <View style={styles.col}>
        <SandboxBanner />
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {value ? (
            <QrCode
              value={value}
              size={220}
              label={shown ? t('mc.qr.label', { amount: formatMoney(shown.minor, shown.currency, locale), handle: `@${handle}` }) : undefined}
            />
          ) : null}
          <Text variant="heading" style={{ textAlign: 'center' }}>
            {shown ? formatMoney(shown.minor, shown.currency, locale) : `@${handle}`}
          </Text>
          <QrHint>{shown ? t('mc.qr.hint') : t('mc.qr.freeHint')}</QrHint>
          <View style={[styles.balance, { backgroundColor: colors.primarySoft }]}>
            <View style={styles.flex}>
              <Text variant="small" muted>
                {t('wallet.balance')}
              </Text>
              <Text variant="bodyStrong" numberOfLines={1}>
                {prefs.hidden ? '••••••' : formatMoney(balance, prefs.currency, locale)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={prefs.hidden ? t('wallet.show') : t('wallet.hide')}
              onPress={() => setWalletPrefs({ hidden: !prefs.hidden })}
              style={styles.iconBtn}
            >
              <Ionicons name={prefs.hidden ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.primary} />
            </Pressable>
          </View>
        </View>
        {adding ? (
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
        ) : (
          <Button label={t('mc.qr.add')} onPress={() => setAdding(true)} />
        )}
        <Button variant="secondary" label={t('mc.qr.share')} disabled={!value} onPress={() => void shareMessage({ message: value }, t('share.copied'))} />
        {shown ? (
          <Button
            variant="ghost"
            label={t('mc.qr.reset')}
            onPress={() => {
              setShown(null);
              setText('');
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  col: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  balance: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.lg, paddingVertical: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.sm },
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
