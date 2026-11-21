import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { useI18n, type MessageKey } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../shop/format';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text } from '../ui';
import { classifyWalletError, failureMessage } from '../wallet/errors';
import { PIN_LENGTH } from '../wallet/pin';
import { PinPad, SandboxBanner } from '../wallet/ui';

/**
 * Feuille de confirmation par code PIN du portefeuille (mode test). `onSubmit` fait le paiement ; une erreur reste affichée dans la
 * feuille (PIN faux sous le clavier, autres refus au-dessus), qui se referme quand `onSubmit` réussit.
 */
export function PinSheet({ visible, hint, onClose, onSubmit }: { visible: boolean; hint: string; onClose: () => void; onSubmit: (pin: string) => Promise<void> }) {
  return (
    <SheetModal visible={visible} onClose={onClose}>
      {visible ? <PinBody hint={hint} onClose={onClose} onSubmit={onSubmit} /> : null}
    </SheetModal>
  );
}

function PinBody({ hint, onClose, onSubmit }: { hint: string; onClose: () => void; onSubmit: (pin: string) => Promise<void> }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    setPinError(null);
    try {
      await onSubmit(value);
    } catch (err) {
      const f = classifyWalletError(err);
      const reason = err instanceof ApiRequestError ? err.detail<string>('reason') : undefined;
      const key = `mon.err.${reason}` as MessageKey;
      const text = (reason && t(key) !== key ? t(key) : null) ?? failureMessage(f, t, (m) => formatMoney(m, 'USD', locale)) ?? errorMessage(err, t, locale);
      setPin('');
      if (f.kind === 'pin_invalid' || f.kind === 'pin_locked' || f.kind === 'pin_not_set') setPinError(text);
      else setError(text);
    } finally {
      setBusy(false);
    }
  };

  const onChange = (v: string) => {
    setPin(v);
    setPinError(null);
    if (v.length === PIN_LENGTH && !busy) void submit(v);
  };

  return (
    <View style={[styles.gap, { alignItems: 'center' }]}>
      <View style={{ alignSelf: 'stretch' }}>
        <SandboxBanner />
      </View>
      <Text muted style={{ textAlign: 'center' }}>
        {hint}
      </Text>
      {error ? (
        <Text color={colors.danger} accessibilityRole="alert" style={{ textAlign: 'center' }}>
          {error}
        </Text>
      ) : null}
      <PinPad value={pin} onChange={onChange} disabled={busy} error={pinError} />
      <Button variant="ghost" label={t('common.cancel')} disabled={busy} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: spacing.md, paddingBottom: spacing.md } });
