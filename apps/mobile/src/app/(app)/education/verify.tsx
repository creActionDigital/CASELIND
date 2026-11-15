import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { verifyCertificate } from '../../../education/api';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../ui';

/** Vérification publique d'un certificat par son code : nom affiché, cours, date, rien d'autre. */
export default function VerifyCertificate() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [code, setCode] = useState('');
  const check = useMutation({ mutationFn: () => verifyCertificate(code.trim().toUpperCase()) });
  const notFound = check.error instanceof ApiRequestError && check.error.status === 404;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('education.verify') }} />
      <View style={styles.body}>
        <TextField label={t('education.verifyCode')} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={12} />
        <Button label={t('education.verifyAction')} loading={check.isPending} disabled={code.trim().length !== 12} onPress={() => check.mutate()} />
        <View accessibilityLiveRegion="polite">
          {check.data ? (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text variant="bodyStrong">{t('education.verifyOk', { name: check.data.holderName, course: check.data.courseTitle, date: new Date(check.data.issuedAt).toLocaleDateString(locale) })}</Text>
            </View>
          ) : null}
          {notFound ? <Text color={colors.danger}>{t('education.verifyNo')}</Text> : check.error ? <Text color={colors.danger}>{errorMessage(check.error, t, locale)}</Text> : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { borderRadius: radius.md, padding: spacing.md },
});
