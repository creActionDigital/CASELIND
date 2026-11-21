import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme/tokens';
import { Button, Screen, Text, Wordmark } from '../../ui';

/** À propos : identité, version de l'application, accès aux données personnelles et à l'aide. */
export default function About() {
  const { t } = useI18n();
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('ma.about.title') }} />
      <View style={{ alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl }}>
        <Wordmark size={28} vertical />
        <Text muted style={{ textAlign: 'center' }}>
          {t('ma.about.tagline')}
        </Text>
        <Text variant="small" muted accessibilityLabel={t('ma.about.versionA11y', { v: version })}>
          {t('ma.about.version', { v: version })}
        </Text>
      </View>
      <Text style={{ marginBottom: spacing.xl }}>{t('ma.about.body')}</Text>
      <Button variant="secondary" label={t('ma.help.title')} onPress={() => router.push('/help')} style={{ marginBottom: spacing.sm }} />
      <Button variant="secondary" label={t('account.privacy')} onPress={() => router.push('/privacy')} style={{ marginBottom: spacing.sm }} />
      <Button variant="secondary" label={t('mydata.title')} onPress={() => router.push('/my-data')} />
    </Screen>
  );
}
