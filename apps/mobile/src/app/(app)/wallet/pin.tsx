import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Text, TextField } from '../../../ui';
import { walletKeys } from '../../../wallet/hooks';
import { checkPin, PIN_LENGTH, validatePinForm } from '../../../wallet/pin';
import { setPaymentPin } from '../../../wallet/pin-api';
import { PinPad, SandboxBanner } from '../../../wallet/ui';
import { safeBack } from '../../../lib/back-target';

type Step = 'enter' | 'confirm' | 'password' | 'done';
const ISSUE_KEY: Record<'length' | 'weak' | 'mismatch' | 'password', MessageKey> = {
  length: 'wallet.pin.issue.length',
  weak: 'wallet.pin.issue.weak',
  mismatch: 'wallet.pin.issue.mismatch',
  password: 'wallet.pin.issue.password',
};

/** Création ou changement du code PIN : deux saisies identiques, puis le mot de passe du compte. */
export default function WalletPin() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('enter');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [issue, setIssue] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => setPaymentPin(pin, password),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: walletKeys.kyc });
      setStep('done');
    },
  });

  function onEnter(v: string) {
    setPin(v);
    setIssue(null);
    if (v.length < PIN_LENGTH) return;
    if (checkPin(v) === 'weak') {
      setIssue(t(ISSUE_KEY.weak));
      setTimeout(() => setPin(''), 400);
      return;
    }
    setStep('confirm');
  }
  function onConfirm(v: string) {
    setConfirm(v);
    setIssue(null);
    if (v.length < PIN_LENGTH) return;
    if (v !== pin) {
      setIssue(t(ISSUE_KEY.mismatch));
      setTimeout(() => setConfirm(''), 400);
      return;
    }
    setStep('password');
  }
  function submit() {
    const bad = validatePinForm(pin, confirm, password);
    if (bad) return setIssue(t(ISSUE_KEY[bad]));
    save.mutate();
  }

  const centered = step === 'enter' || step === 'confirm';
  return (
    <>
      <Stack.Screen options={{ title: t('wallet.pin.title') }} />
      <ScrollView contentContainerStyle={[styles.pad, centered && { alignItems: 'center' }]} keyboardShouldPersistTaps="handled">
        <SandboxBanner />
        {step === 'enter' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('wallet.pin.enterTitle')}
            </Text>
            <Text muted style={{ textAlign: 'center' }}>
              {t('wallet.pin.rules')}
            </Text>
            <PinPad value={pin} onChange={onEnter} error={issue} />
          </>
        ) : null}
        {step === 'confirm' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('wallet.pin.confirmTitle')}
            </Text>
            <PinPad value={confirm} onChange={onConfirm} error={issue} />
            <Button
              variant="ghost"
              label={t('wallet.pin.restart')}
              onPress={() => {
                setPin('');
                setConfirm('');
                setIssue(null);
                setStep('enter');
              }}
            />
          </>
        ) : null}
        {step === 'password' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('wallet.pin.passwordTitle')}
            </Text>
            <Text muted>{t('wallet.pin.passwordHint')}</Text>
            <TextField
              label={t('wallet.pin.password')}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setIssue(null);
                save.reset();
              }}
              secure
              autoCapitalize="none"
              autoComplete="current-password"
            />
            {issue ? (
              <Text variant="small" color={colors.danger}>
                {issue}
              </Text>
            ) : null}
            {save.isError ? (
              <Text variant="small" color={colors.danger} accessibilityRole="alert">
                {errorMessage(save.error, t, locale)}
              </Text>
            ) : null}
            <Button label={t('wallet.pin.save')} loading={save.isPending} onPress={submit} />
          </>
        ) : null}
        {step === 'done' ? (
          <>
            <Text variant="title" accessibilityRole="header">
              {t('wallet.pin.doneTitle')}
            </Text>
            <Text muted>{t('wallet.pin.doneBody')}</Text>
            <Button label={t('wallet.send.finish')} onPress={() => safeBack(router, '/wallet')} />
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({ pad: { padding: spacing.lg, gap: spacing.md } });
