import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { spacing, TOUCH, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Text } from '../Text';

interface Props {
  label: string;
  /** Montant déjà formaté (ex. « 1 250,00 USD »). */
  amount: string;
  /** Libellés de l'œil (afficher / masquer le solde). */
  showLabel: string;
  hideLabel: string;
  initiallyHidden?: boolean;
}

/** Solde en grand, masquable par un œil (« •••• » quand masqué, annoncé aux lecteurs d'écran). */
export function HeroBalance({ label, amount, showLabel, hideLabel, initiallyHidden }: Props) {
  const { colors } = useTheme();
  const [hidden, setHidden] = useState(!!initiallyHidden);
  return (
    <View style={styles.wrap}>
      <Text variant="small" muted>
        {label}
      </Text>
      <View style={styles.row}>
        <Text style={[typography.display, { fontSize: 36, lineHeight: 44 }]} accessibilityLabel={hidden ? `${label}: ••••` : `${label}: ${amount}`}>
          {hidden ? '••••••' : amount}
        </Text>
        <Pressable onPress={() => setHidden((h) => !h)} accessibilityRole="button" accessibilityLabel={hidden ? showLabel : hideLabel} style={styles.eye}>
          <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eye: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
