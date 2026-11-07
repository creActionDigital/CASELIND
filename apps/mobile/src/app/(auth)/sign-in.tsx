import { identifierSchema } from '@caselind/contracts';
import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { AuthShell } from '../../auth/AuthShell';
import { TwoFactorStep } from '../../auth/TwoFactorStep';
import { FormError } from '../../auth/FormError';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { Button, TextField, TextLink } from '../../ui';

export default function SignIn() {
  const { t, locale } = useI18n();
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);

  async function submit() {
    const errs: typeof fieldErrors = {};
    if (!identifierSchema.safeParse(identifier).success) errs.identifier = t('field.identifier.invalid');
    if (!password) errs.password = t('field.required');
    setFieldErrors(errs);
    setError(null);
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      const res = await signIn(identifier, password);
      if (res) {
        setChallengeId(res.challengeId);
        setLoading(false);
      }
    } catch (e) {
      setError(errorMessage(e, t, locale));
      setLoading(false);
    }
  }

  if (challengeId) {
    return (
      <TwoFactorStep
        challengeId={challengeId}
        onRestart={() => {
          setChallengeId(null);
          setPassword('');
        }}
      />
    );
  }

  return (
    <AuthShell title={t('auth.signIn.title')}>
      <FormError message={error} />
      <TextField
        label={t('field.identifier')}
        hint={t('field.identifier.hint')}
        error={fieldErrors.identifier}
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="username"
      />
      <TextField
        label={t('field.password')}
        error={fieldErrors.password}
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        textContentType="password"
        autoComplete="current-password"
        onSubmitEditing={submit}
      />
      <Button label={t('auth.signIn.submit')} onPress={submit} loading={loading} />
      <TextLink label={t('auth.signIn.forgot')} href="/forgot-password" />
      <TextLink label={t('auth.signIn.toSignUp')} href="/sign-up" />
    </AuthShell>
  );
}
