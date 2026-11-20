import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, Text } from '../../ui';
import { classifyWalletError } from '../errors';
import { PIN_LENGTH } from '../pin';
import { PinPad, SandboxBanner } from '../ui';
import { financeErrorMessage } from './errors';

/** En-tête commun : bandeau « mode test » du portefeuille (il dit déjà que rien n'est relié à Mobile Money). */
export function FinanceHeader() {
  return <SandboxBanner />;
}

/** Carte simple sur fond de surface. */
export function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.surface }]}>{children}</View>;
}

/**
 * Saisie du PIN en plein écran. `onSubmit` est lancé dès que les 6 chiffres sont saisis ; s'il refuse, le message s'affiche
 * sous le pavé (PIN faux, verrouillé, fonds, limite, gel...) et le pavé se vide pour un nouvel essai.
 */
export function PinPrompt({ hint, onSubmit, onCancel }: { hint: string; onSubmit: (pin: string) => Promise<void>; onCancel: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needPin, setNeedPin] = useState(false);

  async function change(v: string) {
    setPin(v);
    setError(null);
    if (v.length !== PIN_LENGTH || busy) return;
    setBusy(true);
    try {
      await onSubmit(v);
    } catch (err) {
      setPin('');
      setNeedPin(classifyWalletError(err).kind === 'pin_not_set');
      setError(financeErrorMessage(err, t, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.pad, { alignItems: 'center' }]}>
      <View style={{ alignSelf: 'stretch' }}>
        <FinanceHeader />
      </View>
      <Text variant="heading" accessibilityRole="header">
        {t('wf.pin.title')}
      </Text>
      <Text muted style={{ textAlign: 'center' }}>
        {hint}
      </Text>
      <PinPad value={pin} onChange={(v) => void change(v)} disabled={busy} error={error} />
      {busy ? <Text muted>{t('wf.pin.working')}</Text> : null}
      {needPin ? <Button label={t('wallet.send.createPin')} onPress={() => router.push('/wallet/pin')} /> : null}
      <Button variant="ghost" label={t('common.cancel')} onPress={onCancel} disabled={busy} />
    </ScrollView>
  );
}

export const financeStyles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  pad: { padding: spacing.lg, gap: spacing.md },
});
