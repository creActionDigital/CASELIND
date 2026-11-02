import { passwordSchema } from '@caselind/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { AuthShell } from '../../auth/AuthShell';
import { OtpForm } from '../../auth/OtpForm';
import { useI18n } from '../../i18n';
import { Text, TextField } from '../../ui';

export default function ResetPassword() {
  const { t } = useI18n();
  const { resetPassword, resendOtp } = useAuth();
  const router = useRouter();
  const { challengeId } = useLocalSearchParams<{ challengeId?: string }>();
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  if (!challengeId) {
    return (
      <AuthShell title={t('auth.reset.title')}>
        <Text muted>{t('auth.otp.missing')}</Text>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')}>
      <OtpForm
        submitLabel={t('auth.reset.submit')}
        validateExtra={() => {
          const ok = passwordSchema.safeParse(password).success;
          setPwError(ok ? null : t('field.password.short'));
          return ok;
        }}
        onSubmit={async (code) => {
          await resetPassword({ challengeId, code, newPassword: password });
          router.replace('/sign-in');
        }}
        onResend={() => resendOtp(challengeId)}
      >
        <TextField
          label={t('field.newPassword')}
          hint={t('field.password.hint')}
          error={pwError}
          value={password}
          onChangeText={setPassword}
          secure
          autoCapitalize="none"
          autoComplete="new-password"
        />
      </OtpForm>
    </AuthShell>
  );
}
