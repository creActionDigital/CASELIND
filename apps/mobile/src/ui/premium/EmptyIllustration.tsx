import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { brandAccent, radius, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../Button';
import { Text } from '../Text';
import { FadeInView } from './FadeInView';

interface Props {
  icon?: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** État vide élégant : icône dans un double cercle (bleu doux + anneau orange), titre, texte et action, en apparition douce. */
export function EmptyIllustration({ icon = 'sparkles-outline', title, body, actionLabel, onAction }: Props) {
  const { colors } = useTheme();
  return (
    <FadeInView style={styles.wrap}>
      <View style={[styles.ring, { borderColor: brandAccent }]}>
        <View style={[styles.disc, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name={icon} size={36} color={colors.primary} />
        </View>
      </View>
      <Text variant="heading" accessibilityRole="header" style={styles.center}>
        {title}
      </Text>
      {body ? (
        <Text muted style={styles.center}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl },
  ring: { width: 112, height: 112, borderRadius: radius.pill, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  disc: { width: 84, height: 84, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
