import { Pressable, StyleSheet, View } from 'react-native';
import { spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Text } from '../Text';

interface Props {
  title: string;
  /** Libellé du lien (ex. « Voir tout ») ; sans `onAction`, aucun lien n'est affiché. */
  actionLabel?: string;
  onAction?: () => void;
}

/** En-tête de section : titre à gauche, lien « Voir tout » à droite (cible ≥ 44 px). */
export function SectionHeader({ title, actionLabel, onAction }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </Text>
      {onAction && actionLabel ? (
        <Pressable onPress={onAction} accessibilityRole="link" accessibilityLabel={`${actionLabel}, ${title}`} style={styles.link} hitSlop={6}>
          <Text variant="small" color={colors.primary} style={{ fontWeight: '600' }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH },
  link: { minHeight: TOUCH, justifyContent: 'center', paddingLeft: spacing.sm },
});
