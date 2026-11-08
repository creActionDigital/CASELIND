import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { onMedia, radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { Chip } from './parts';
import { isColorAxis, isSizeAxis, swatchColor } from './swatch';

interface Props {
  axis: { name: string; values: string[] };
  selected?: string;
  isDisabled: (value: string) => boolean;
  onSelect: (value: string) => void;
}

const LIGHT_SWATCHES = new Set(['#ffffff', '#f5c400', '#d8c3a5']);

/** Sélecteur d'un axe d'options : tailles et couleurs en ronds, autres options en pastilles. */
export function AxisPicker({ axis, selected, isDisabled, onSelect }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const color = isColorAxis(axis.name);
  const size = isSizeAxis(axis.name);
  return (
    <View style={styles.wrap}>
      {axis.values.map((val) => {
        const on = selected === val;
        const disabled = isDisabled(val) && !on;
        const hex = color ? swatchColor(val) : null;
        if (hex) {
          return (
            <Pressable
              key={val}
              accessibilityRole="button"
              accessibilityLabel={t('product.colorA11y', { value: val })}
              accessibilityState={{ selected: on, disabled }}
              disabled={disabled}
              onPress={() => onSelect(val)}
              style={[styles.hit, { opacity: disabled ? 0.35 : 1 }]}
            >
              <View style={[styles.dot, { backgroundColor: hex, borderColor: on ? colors.text : colors.border, borderWidth: on ? 3 : 1 }]}>
                {on ? <Ionicons name="checkmark" size={18} color={LIGHT_SWATCHES.has(hex.toLowerCase()) ? '#111111' : onMedia} /> : null}
              </View>
            </Pressable>
          );
        }
        if (size && val.length <= 4) {
          return (
            <Pressable
              key={val}
              accessibilityRole="button"
              accessibilityLabel={t('product.sizeA11y', { value: val })}
              accessibilityState={{ selected: on, disabled }}
              disabled={disabled}
              onPress={() => onSelect(val)}
              style={[styles.hit, { opacity: disabled ? 0.35 : 1 }]}
            >
              <View style={[styles.dot, { backgroundColor: on ? colors.text : colors.surfaceAlt }]}>
                <Text variant="caption" color={on ? colors.background : colors.text} style={{ fontWeight: '700' }}>
                  {val}
                </Text>
              </View>
            </Pressable>
          );
        }
        return <Chip key={val} label={val} selected={on} disabled={disabled} onPress={() => onSelect(val)} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  hit: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
