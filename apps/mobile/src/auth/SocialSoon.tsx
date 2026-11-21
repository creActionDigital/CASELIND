import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';

const PROVIDERS = [
  { key: 'Google', icon: 'logo-google' },
  { key: 'Apple', icon: 'logo-apple' },
  { key: 'Facebook', icon: 'logo-facebook' },
] as const;

/** Connexion Google / Apple / Facebook : écrans prêts, désactivés tant que les clés des fournisseurs n'existent pas (aucun appel réseau). */
export function SocialSoon() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.wrap}>
      <Text variant="small" muted style={{ textAlign: 'center' }}>
        {t('ma.social.or')}
      </Text>
      {PROVIDERS.map((p) => (
        <View
          key={p.key}
          accessible
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityLabel={`${t('ma.social.continue', { name: p.key })}, ${t('ma.soonAvailable')}`}
          style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.surfaceAlt, opacity: 0.6 }]}
        >
          <Ionicons name={p.icon} size={20} color={colors.textMuted} />
          <Text muted style={{ flex: 1 }}>
            {t('ma.social.continue', { name: p.key })}
          </Text>
          <Text variant="caption" muted>
            {t('ma.soonAvailable')}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.lg },
  btn: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderWidth: 1, borderRadius: radius.pill },
});
