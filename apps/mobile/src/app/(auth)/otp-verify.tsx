import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../auth/auth-context';
import { AuthShell } from '../../auth/AuthShell';
import { OtpForm } from '../../auth/OtpForm';
import { useI18n } from '../../i18n';
import { Text } from '../../ui';

export default function OtpVerify() {
  const { t } = useI18n();
  const { verifyOtp, resendOtp } = useAuth();
  const params = useLocalSearchParams<{ challengeId?: string; channel?: string }>();
  const challengeId = params.challengeId;
  const channel = params.channel === 'email' ? t('auth.otp.channel.email') : t('auth.otp.channel.sms');
  if (!challengeId) {
    return (
      <AuthShell title={t('auth.otp.title')}>
        <Text muted>{t('auth.otp.missing')}</Text>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t('auth.otp.title')} subtitle={t('auth.otp.subtitle', { channel })}>
      <OtpForm
        submitLabel={t('auth.otp.submit')}
        onSubmit={(code) => verifyOtp(challengeId, code)}
        onResend={() => resendOtp(challengeId)}
      />
    </AuthShell>
  );
}
