import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Screen, Text } from '../../../ui';

/** Biométrie : écran prêt mais désactivé (« Bientôt disponible »), sans aucune logique d'authentification. */
export default function Biometrics() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('ma.bio.title') }} />
      <Text muted style={{ marginBottom: spacing.lg }}>
        {t('ma.bio.intro')}
      </Text>
      <View accessible accessibilityState={{ disabled: true }} accessibilityLabel={`${t('ma.bio.toggle')}, ${t('ma.soonAvailable')}`} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.6 }]}>
        <Ionicons name="finger-print-outline" size={26} color={colors.textMuted} />
        <Text style={{ flex: 1 }}>{t('ma.bio.toggle')}</Text>
        <Badge tone="neutral" label={t('ma.soonAvailable')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderRadius: radius.md } });
