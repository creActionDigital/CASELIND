import { backupCodeSchema, otpCodeSchema } from '@caselind/contracts';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { twoFactorErrorMessage } from '../security/errors';
import { Button, Text, TextField, TextLink } from '../ui';
import { useAuth } from './auth-context';
import { AuthShell } from './AuthShell';
import { FormError } from './FormError';

interface Props {
  challengeId: string;
  /** Défi expiré ou épuisé : retour à la saisie de l'identifiant. */
  onRestart(): void;
}

/** Deuxième étape de la connexion : code à 6 chiffres de l'application, ou code de secours. */
export function TwoFactorStep({ challengeId, onRestart }: Props) {
  const { t, locale } = useI18n();
  const { verifyTwoFactor } = useAuth();
  const [backup, setBackup] = useState(false);
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; dead: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    const ok = backup ? backupCodeSchema.safeParse(value).success : otpCodeSchema.safeParse(value).success;
    setFieldError(ok ? null : t(backup ? 'security.login.backupInvalid' : 'field.code.invalid'));
    if (!ok) return;
    setLoading(true);
    try {
      await verifyTwoFactor(challengeId, backup ? { backupCode: value.trim() } : { code: value });
    } catch (e) {
      setError(twoFactorErrorMessage(e, t, locale));
      setLoading(false);
    }
  }

  function toggle() {
    setBackup((b) => !b);
    setValue('');
    setFieldError(null);
    setError(null);
  }

  return (
    <AuthShell title={t(backup ? 'security.login.backupTitle' : 'security.login.title')}>
      <Text muted style={{ marginBottom: 16 }}>
        {t(backup ? 'security.login.backupBody' : 'security.login.body')}
      </Text>
      <FormError message={error?.message ?? null} />
      <TextField
        label={t(backup ? 'security.login.backupField' : 'field.code')}
        error={fieldError}
        value={value}
        onChangeText={(v) => setValue(backup ? v : v.replace(/\D/g, '').slice(0, 6))}
        keyboardType={backup ? 'default' : 'number-pad'}
        maxLength={backup ? 32 : 6}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={backup ? 'off' : 'one-time-code'}
        onSubmitEditing={submit}
      />
      {error?.dead ? (
        <Button label={t('security.login.restart')} onPress={onRestart} />
      ) : (
        <Button label={t('security.login.verify')} onPress={submit} loading={loading} />
      )}
      <Button
        variant="ghost"
        label={t(backup ? 'security.login.useCode' : 'security.login.useBackup')}
        onPress={toggle}
        style={{ marginTop: 8 }}
      />
      <TextLink label={t('security.login.cancel')} onPress={onRestart} />
    </AuthShell>
  );
}
