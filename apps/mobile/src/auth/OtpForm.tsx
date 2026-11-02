import { otpCodeSchema, type ChallengeResponse } from '@caselind/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useI18n } from '../i18n';
import { errorMessage, retryAfterSeconds } from '../lib/errors';
import { Button, Text, TextField } from '../ui';
import { FormError } from './FormError';

const RESEND_DELAY = 30;

function useResendTimer(initial = RESEND_DELAY) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return { left, restart: (n = RESEND_DELAY) => setLeft(n) };
}

interface Props {
  submitLabel: string;
  onSubmit(code: string): Promise<void>;
  onResend(): Promise<ChallengeResponse>;
  /** Champs additionnels affichés avant le bouton. */
  children?: ReactNode;
  /** Valide les champs additionnels ; retourne false pour bloquer l'envoi. */
  validateExtra?(): boolean;
}

/** Saisie du code à 6 chiffres avec renvoi (délai) ; partagé par OtpVerify et ResetPassword. */
export function OtpForm({ submitLabel, onSubmit, onResend, children, validateExtra }: Props) {
  const { t, locale } = useI18n();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useResendTimer();

  async function submit() {
    setError(null);
    setInfo(null);
    const okCode = otpCodeSchema.safeParse(code).success;
    setCodeError(okCode ? null : t('field.code.invalid'));
    const okExtra = validateExtra ? validateExtra() : true;
    if (!okCode || !okExtra) return;
    setLoading(true);
    try {
      await onSubmit(code);
    } catch (e) {
      setError(errorMessage(e, t, locale));
      setLoading(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    try {
      await onResend();
      setInfo(t('auth.otp.resent'));
      timer.restart();
    } catch (e) {
      setError(errorMessage(e, t, locale));
      const wait = retryAfterSeconds(e);
      if (wait) timer.restart(wait);
    }
  }

  return (
    <View>
      <FormError message={error} />
      {info ? (
        <Text variant="small" accessibilityLiveRegion="polite" style={{ marginBottom: 12 }}>
          {info}
        </Text>
      ) : null}
      <TextField
        label={t('field.code')}
        error={codeError}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
      />
      {children}
      <Button label={submitLabel} onPress={submit} loading={loading} />
      <Button
        variant="ghost"
        label={timer.left > 0 ? t('auth.otp.resendIn', { n: timer.left }) : t('auth.otp.resend')}
        onPress={resend}
        disabled={timer.left > 0}
        style={{ marginTop: 8 }}
      />
    </View>
  );
}
