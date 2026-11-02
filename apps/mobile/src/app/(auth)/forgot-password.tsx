import { identifierSchema } from '@caselind/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { AuthShell } from '../../auth/AuthShell';
import { FormError } from '../../auth/FormError';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { Button, TextField, TextLink } from '../../ui';

export default function ForgotPassword() {
  const { t, locale } = useI18n();
  const { forgotPassword } = useAuth();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    const ok = identifierSchema.safeParse(identifier).success;
    setFieldError(ok ? null : t('field.identifier.invalid'));
    if (!ok) return;
    setLoading(true);
    try {
      const c = await forgotPassword(identifier);
      router.push({ pathname: '/reset-password', params: { challengeId: c.challengeId } });
    } catch (e) {
      setError(errorMessage(e, t, locale));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')}>
      <FormError message={error} />
      <TextField
        label={t('field.identifier')}
        hint={t('field.identifier.hint')}
        error={fieldError}
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <Button label={t('auth.forgot.submit')} onPress={submit} loading={loading} />
      <TextLink label={t('common.back')} href="/sign-in" />
    </AuthShell>
  );
}
