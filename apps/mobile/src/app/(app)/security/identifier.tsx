import { identifierSchema, type ChallengeResponse } from '@caselind/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { FormError } from '../../../auth/FormError';
import { OtpForm } from '../../../auth/OtpForm';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { requestIdentifierChange, verifyIdentifierChange } from '../../../security/api';
import { securityErrorMessage } from '../../../security/errors';
import { Card } from '../../../security/ui';
import { Button, Screen, Text, TextField } from '../../../ui';
import { safeBack } from '../../../lib/back-target';

type Step = 'form' | 'code' | 'done';

/** Changement de téléphone ou d'e-mail : mot de passe, code envoyé au NOUVEL identifiant (ADR-020 : pas de second facteur). */
export default function ChangeIdentifier() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { resendOtp } = useAuth();
  const [step, setStep] = useState<Step>('form');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [issue, setIssue] = useState<{ identifier?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);

  async function submit() {
    const next = {
      identifier: identifierSchema.safeParse(identifier.trim()).success ? undefined : t('field.identifier.invalid'),
      password: password ? undefined : t('field.required'),
    };
    setIssue(next);
    setError(null);
    if (next.identifier || next.password) return;
    setLoading(true);
    try {
      setChallenge(await requestIdentifierChange(identifier, password));
      setStep('code');
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 409 ? t('security.identifier.taken') : securityErrorMessage(e, t, locale),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('security.identifier.title') }} />
      <View style={{ gap: 16, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        {step === 'form' ? (
          <>
            <Text muted>{t('security.identifier.intro')}</Text>
            <Card tone="info">
              <Text variant="small">{t('security.identifier.warn')}</Text>
            </Card>
            <FormError message={error} />
            <TextField
              label={t('security.identifier.new')}
              hint={t('field.identifier.hint')}
              error={issue.identifier}
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <TextField
              label={t('field.password')}
              error={issue.password}
              value={password}
              onChangeText={setPassword}
              secure
              autoCapitalize="none"
              autoComplete="current-password"
              onSubmitEditing={submit}
            />
            <Button label={t('security.identifier.send')} onPress={submit} loading={loading} />
          </>
        ) : null}

        {step === 'code' && challenge ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('security.identifier.codeTitle')}
            </Text>
            <Text muted>
              {t(challenge.channel === 'sms' ? 'security.identifier.codeSms' : 'security.identifier.codeEmail', {
                to: identifier.trim(),
              })}
            </Text>
            <OtpForm
              submitLabel={t('security.identifier.confirm')}
              onResend={() => resendOtp(challenge.challengeId)}
              onSubmit={async (code) => {
                await verifyIdentifierChange(challenge.challengeId, code);
                void qc.invalidateQueries({ queryKey: ['sessions'] });
                setStep('done');
              }}
            />
            <Button variant="ghost" label={t('common.back')} onPress={() => setStep('form')} />
          </>
        ) : null}

        {step === 'done' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('security.identifier.doneTitle')}
            </Text>
            <Text muted>{t('security.identifier.doneBody')}</Text>
            <Button label={t('common.close')} onPress={() => safeBack(router, '/profile')} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
