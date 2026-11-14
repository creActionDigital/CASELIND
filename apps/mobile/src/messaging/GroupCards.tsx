import type { Conversation } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { conversationTitle } from './api';

/** « Mes groupes » (maquette communities) : cartes teintées unies, nom et nombre de membres. Pas de découverte publique : le backend n'en a pas. */
export function GroupCards({ groups, onOpen }: { groups: Conversation[]; onOpen: (c: Conversation) => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  if (groups.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text variant="bodyStrong" accessibilityRole="header" style={styles.title}>
        {t('chat.groups.mine')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {groups.map((g) => (
          <Pressable
            key={g.id}
            accessibilityRole="button"
            accessibilityLabel={conversationTitle(g, t)}
            onPress={() => onOpen(g)}
            style={({ pressed }) => [styles.card, { backgroundColor: colors.primarySoft, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text variant="bodyStrong" numberOfLines={2}>
              {conversationTitle(g, t)}
            </Text>
            <View style={styles.count}>
              <Ionicons name="people-outline" size={16} color={colors.primary} />
              <Text variant="small">{g.memberCount}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  title: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  strip: { paddingHorizontal: spacing.lg, gap: spacing.md },
  card: { width: 170, minHeight: 104, borderRadius: radius.xl, padding: spacing.md, justifyContent: 'space-between' },
  count: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
