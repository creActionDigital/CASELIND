import { StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';

const STEPS: MessageKey[] = ['mc.steps.cart', 'mc.steps.delivery', 'mc.steps.done'];

/** Étapes d'achat : panier, livraison et paiement, confirmation. L'étape courante est pleine ; pas seulement la couleur (numéro et libellé). */
export function Steps({ current }: { current: 0 | 1 | 2 }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.row} accessible accessibilityLabel={t('mc.steps.a11y', { n: current + 1, total: STEPS.length, label: t(STEPS[current]!) })}>
      {STEPS.map((k, i) => {
        const on = i <= current;
        return (
          <View key={k} style={styles.step}>
            <View style={[styles.dot, { backgroundColor: on ? colors.primary : colors.surfaceAlt }]}>
              <Text variant="caption" color={on ? colors.onPrimary : colors.textMuted} style={{ fontWeight: '700' }}>
                {i + 1}
              </Text>
            </View>
            {i === current ? (
              <Text variant="caption" color={i === current ? colors.text : colors.textMuted} numberOfLines={1} style={{ flexShrink: 1, fontWeight: i === current ? '700' : '400' }}>
                {t(k)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  dot: { width: 24, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
