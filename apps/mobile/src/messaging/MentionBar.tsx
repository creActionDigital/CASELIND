import type { ConversationMember } from '@caselind/contracts';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';

/** Suggestions de membres actifs pendant la saisie d'un « @pseudo » dans un groupe. */
export function MentionBar({ members, onPick }: { members: readonly ConversationMember[]; onPick: (m: ConversationMember) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  if (members.length === 0) return null;
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={{ backgroundColor: colors.surfaceAlt }}>
      {members.map((m) => (
        <Pressable
          key={m.userId}
          accessibilityRole="button"
          accessibilityLabel={t('mention.a11y', { name: m.displayName })}
          onPress={() => onPick(m)}
          style={({ pressed }) => [styles.chip, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text variant="small" style={{ fontWeight: '600' }}>
            @{m.handle}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {m.displayName}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chip: { minHeight: TOUCH - 8, justifyContent: 'center', borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md },
});
