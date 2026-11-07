import { backupCodeSchema, otpCodeSchema } from '@caselind/contracts';
import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { FormError } from '../../../auth/FormError';
import { useAuth } from '../../../auth/auth-context';
import { useI18n } from '../../../i18n';
import { totpDisable, totpEnable, totpSetup } from '../../../security/api';
import { securityErrorMessage } from '../../../security/errors';
import { loadQrComponent, shareText } from '../../../security/optional';
import { backupCodesText, formatSecret, isOtpauthUri, rawSecret } from '../../../security/totp';
import { Card, Checkbox, CopyButton } from '../../../security/ui';
import { useTheme } from '../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../ui';

type Step = 'home' | 'setup' | 'codes' | 'disable' | 'disabled';

/** Double authentification TOTP : activation (secret, code, mot de passe, codes de secours) et désactivation. */
export default function TwoFactor() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const { me, setMe } = useAuth();
  const enabled = me?.twoFactorEnabled ?? false;
  const [step, setStep] = useState<Step>('home');
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [issue, setIssue] = useState<{ code?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const Qr = useMemo(() => loadQrComponent(), []);

  const start = useMutation({
    mutationFn: totpSetup,
    onSuccess: (r) => {
      setSetup(r);
      setStep('setup');
    },
    onError: (e) => {
      setError(securityErrorMessage(e, t, locale));
    },
  });
  const enable = useMutation({
    mutationFn: () => totpEnable(code, password),
    onSuccess: (r) => {
      setCodes(r.backupCodes);
      if (me) setMe({ ...me, twoFactorEnabled: true });
      setSetup(null);
      setCode('');
      setPassword('');
      setStep('codes');
    },
    onError: (e) => setError(securityErrorMessage(e, t, locale)),
  });
  const disable = useMutation({
    mutationFn: () => totpDisable(useBackup ? { password, backupCode: code.trim() } : { password, code }),
    onSuccess: () => {
      if (me) setMe({ ...me, twoFactorEnabled: false });
      setCode('');
      setPassword('');
      setStep('disabled');
    },
    onError: (e) => setError(securityErrorMessage(e, t, locale)),
  });

  function reset(next: Step) {
    setError(null);
    setIssue({});
    setCode('');
    setPassword('');
    setUseBackup(false);
    setStep(next);
  }

  function validate(): boolean {
    const codeOk = useBackup ? backupCodeSchema.safeParse(code).success : otpCodeSchema.safeParse(code).success;
    const next = {
      code: codeOk ? undefined : t(useBackup ? 'security.login.backupInvalid' : 'field.code.invalid'),
      password: password ? undefined : t('field.required'),
    };
    setIssue(next);
    setError(null);
    return !next.code && !next.password;
  }

  const codeField = (
    <TextField
      label={t(useBackup ? 'security.login.backupField' : 'security.2fa.codeField')}
      error={issue.code}
      value={code}
      onChangeText={(v) => setCode(useBackup ? v : v.replace(/\D/g, '').slice(0, 6))}
      keyboardType={useBackup ? 'default' : 'number-pad'}
      maxLength={useBackup ? 32 : 6}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
  const passwordField = (
    <TextField
      label={t('field.password')}
      error={issue.password}
      value={password}
      onChangeText={setPassword}
      secure
      autoCapitalize="none"
      autoComplete="current-password"
    />
  );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('security.2fa.title') }} />
      <View style={{ gap: 16, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <FormError message={error} />

        {step === 'home' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('security.2fa.title')}
            </Text>
            <Text muted>{t('security.2fa.intro')}</Text>
            {enabled ? (
              <Button variant="secondary" label={t('security.2fa.disable')} onPress={() => reset('disable')} />
            ) : (
              <Button label={t('security.2fa.enable')} loading={start.isPending} onPress={() => { setError(null); start.mutate(); }} />
            )}
          </>
        ) : null}

        {step === 'setup' && setup ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('security.2fa.setupTitle')}
            </Text>
            <Text muted>{t('security.2fa.setupBody')}</Text>
            {Qr ? (
              <View style={{ alignSelf: 'center', padding: 12, backgroundColor: '#FFFFFF', borderRadius: 12 }} accessibilityLabel={t('security.2fa.qrA11y')}>
                <Qr value={setup.otpauthUri} size={180} color="#000000" backgroundColor="#FFFFFF" />
              </View>
            ) : null}
            <Card>
              <Text variant="small" muted>
                {t('security.2fa.secretLabel')}
              </Text>
              <Text variant="heading" selectable accessibilityLabel={formatSecret(setup.secret).split('').join(' ')} style={{ letterSpacing: 1 }}>
                {formatSecret(setup.secret)}
              </Text>
              <CopyButton text={rawSecret(setup.secret)} />
            </Card>
            {isOtpauthUri(setup.otpauthUri) ? (
              <Button
                variant="secondary"
                label={t('security.2fa.openApp')}
                onPress={() => {
                  Linking.openURL(setup.otpauthUri).catch(() => setError(t('security.2fa.noApp')));
                }}
              />
            ) : null}
            <Text variant="bodyStrong">{t('security.2fa.confirmTitle')}</Text>
            {codeField}
            {passwordField}
            <Button
              label={t('security.2fa.confirm')}
              loading={enable.isPending}
              onPress={() => {
                if (validate()) enable.mutate();
              }}
            />
            <Button variant="ghost" label={t('common.cancel')} onPress={() => { setSetup(null); reset('home'); }} />
          </>
        ) : null}

        {step === 'codes' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('security.2fa.codesTitle')}
            </Text>
            <Card tone="warn">
              <Text variant="small" color={colors.danger}>
                {t('security.2fa.codesWarn')}
              </Text>
            </Card>
            <Card>
              {codes.map((c) => (
                <Text key={c} variant="heading" selectable style={{ fontVariant: ['tabular-nums'] }}>
                  {c}
                </Text>
              ))}
            </Card>
            <CopyButton text={backupCodesText(codes)} label={t('security.2fa.copyCodes')} />
            <Button variant="secondary" label={t('security.2fa.shareCodes')} onPress={() => void shareText(backupCodesText(codes))} />
            <Checkbox checked={saved} onChange={setSaved} label={t('security.2fa.savedCheck')} />
            <Button
              label={t('security.2fa.done')}
              disabled={!saved}
              onPress={() => {
                setCodes([]);
                setSaved(false);
                reset('home');
              }}
            />
          </>
        ) : null}

        {step === 'disable' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('security.2fa.disable')}
            </Text>
            <Text muted>{t('security.2fa.disableBody')}</Text>
            {passwordField}
            {codeField}
            <Button
              variant="ghost"
              label={t(useBackup ? 'security.login.useCode' : 'security.login.useBackup')}
              onPress={() => { setUseBackup((b) => !b); setCode(''); setIssue({}); }}
            />
            <Button
              variant="danger"
              label={t('security.2fa.disableConfirm')}
              loading={disable.isPending}
              onPress={() => {
                if (validate()) disable.mutate();
              }}
            />
            <Button variant="ghost" label={t('common.cancel')} onPress={() => reset('home')} />
          </>
        ) : null}

        {step === 'disabled' ? (
          <>
            <Text variant="heading" accessibilityRole="header">
              {t('security.2fa.disabledTitle')}
            </Text>
            <Text muted>{t('security.2fa.disabledBody')}</Text>
            <Button label={t('security.2fa.done')} onPress={() => reset('home')} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
