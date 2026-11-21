import { identifierSchema, passwordSchema } from '@caselind/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { AuthShell } from '../../auth/AuthShell';
import { SocialSoon } from '../../auth/SocialSoon';
import { FormError } from '../../auth/FormError';
import { useI18n } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { setPrefs } from '../../prefs/store';
import { Button, TextField, TextLink } from '../../ui';

export default function SignUp() {
  const { t, locale } = useI18n();
  const { register } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errs, setErrs] = useState<{ displayName?: string; identifier?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    const e: typeof errs = {};
    if (!displayName.trim()) e.displayName = t('field.required');
    if (!identifierSchema.safeParse(identifier).success) e.identifier = t('field.identifier.invalid');
    if (!passwordSchema.safeParse(password).success) e.password = t('field.password.short');
    setErrs(e);
    setError(null);
    if (Object.keys(e).length) return;
    setLoading(true);
    try {
      const challenge = await register({ identifier, password, displayName });
      setPrefs({ profileSetupPending: true });
      router.push({ pathname: '/otp-verify', params: { challengeId: challenge.challengeId, channel: challenge.channel } });
    } catch (err) {
      setError(errorMessage(err, t, locale));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title={t('auth.signUp.title')}>
      <FormError message={error} />
      <TextField label={t('field.displayName')} error={errs.displayName} value={displayName} onChangeText={setDisplayName} autoComplete="name" />
      <TextField
        label={t('field.identifier')}
        hint={t('field.identifier.hint')}
        error={errs.identifier}
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="username"
      />
      <TextField
        label={t('field.password')}
        hint={t('field.password.hint')}
        error={errs.password}
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Button label={t('auth.signUp.submit')} onPress={submit} loading={loading} />
      <TextLink label={t('auth.signUp.toSignIn')} href="/sign-in" />
      <SocialSoon />
    </AuthShell>
  );
}
