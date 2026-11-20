import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useI18n } from '../i18n';
import { spacing } from '../theme/tokens';
import { Screen, Text, Wordmark } from '../ui';

/** Cadre commun des écrans d'authentification. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Screen>
      <View style={{ maxWidth: 480, width: '100%', alignSelf: 'center', paddingTop: spacing.xl }}>
        <Wordmark size={24} vertical />
        <Text variant="small" muted style={{ marginTop: spacing.xs, marginBottom: spacing.xxl, textAlign: 'center' }}>
          {t('auth.tagline')}
        </Text>
        <Text variant="title" accessibilityRole="header" style={{ marginBottom: spacing.xs }}>
          {title}
        </Text>
        {subtitle ? (
          <Text muted style={{ marginBottom: spacing.xl }}>
            {subtitle}
          </Text>
        ) : (
          <View style={{ height: spacing.lg }} />
        )}
        {children}
      </View>
    </Screen>
  );
}
