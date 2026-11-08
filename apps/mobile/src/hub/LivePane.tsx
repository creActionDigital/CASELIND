import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { brandColor, glass, onMedia, radius, TAB_BAR_SPACE, TOUCH } from '../theme/tokens';
import { Text } from '../ui';

/** Onglet Live : aucun service de diffusion n'existe encore ; on l'annonce honnêtement et on propose l'aperçu du design. */
export function LivePane() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 88, paddingBottom: TAB_BAR_SPACE }]}>
      <Ionicons name="radio-outline" size={56} color="rgba(255,255,255,0.6)" />
      <Text variant="title" color={onMedia} style={styles.center} accessibilityRole="header">
        {t('live.none')}
      </Text>
      <Text color="#D4D4DC" style={styles.center}>
        {t('live.noneBody')}
      </Text>
      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={`${t('live.start')}, ${t('live.soon')}`}
        style={[styles.start, { opacity: 0.55 }]}
      >
        <Text variant="bodyStrong" color={onMedia}>
          {t('live.start')}
        </Text>
        <View style={styles.soon}>
          <Text variant="caption" color="#1A1200">
            {t('live.soon')}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('live.previewCard')}
        onPress={() => router.push('/live/preview')}
        style={({ pressed }) => [styles.card, { opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name="color-palette-outline" size={26} color={onMedia} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" color={onMedia}>
            {t('live.previewCard')}
          </Text>
          <Text variant="caption" color="#D4D4DC">
            {t('live.previewBody')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={onMedia} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#14141B' },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  start: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: TOUCH,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    backgroundColor: brandColor,
  },
  soon: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: '#FACC15' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'stretch',
    minHeight: TOUCH + 16,
    padding: 14,
    marginTop: 12,
    borderRadius: radius.lg,
    backgroundColor: glass.dark,
    borderWidth: 1,
    borderColor: glass.border,
  },
});
