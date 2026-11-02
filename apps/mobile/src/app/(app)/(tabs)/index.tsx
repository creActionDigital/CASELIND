import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Avatar, EmptyState, Screen, Text } from '../../../ui';
import { useAuth } from '../../../auth/auth-context';

/** Accueil : barre de stories en haut, puis le flux (vide tant que le backend social n'existe pas). */
export default function Home() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { me } = useAuth();
  return (
    <Screen edges={[]} padded={false}>
      <View style={[styles.stories, { borderBottomColor: colors.border }]} accessibilityLabel={t('home.stories.empty')}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesRow}>
          <View accessible accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={t('home.stories.addA11y')} style={styles.story}>
            <View style={[styles.ring, { borderColor: colors.border }]}>
              <Avatar name={me?.displayName ?? '?'} size={56} />
              <View style={[styles.plus, { backgroundColor: colors.accent, borderColor: colors.background }]}>
                <Ionicons name="add" size={14} color={colors.onAccent} />
              </View>
            </View>
            <Text variant="caption" muted numberOfLines={1}>
              {t('home.stories.mine')}
            </Text>
          </View>
          <Text variant="small" muted style={styles.storiesEmpty}>
            {t('home.stories.empty')}
          </Text>
        </ScrollView>
      </View>
      <EmptyState icon="newspaper-outline" title={t('home.feed.emptyTitle')} body={t('home.feed.emptyBody')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stories: { borderBottomWidth: StyleSheet.hairlineWidth },
  storiesRow: { alignItems: 'center', padding: spacing.lg, gap: spacing.lg },
  story: { alignItems: 'center', gap: spacing.xs, width: 72 },
  ring: { borderWidth: 2, borderStyle: 'dashed', borderRadius: radius.pill, padding: 2 },
  plus: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  storiesEmpty: { maxWidth: 220 },
});
