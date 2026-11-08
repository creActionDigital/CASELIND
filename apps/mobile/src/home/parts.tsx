import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import type { CachedPost } from '../social/logic';
import { brandColor, onMedia, radius, shadow, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';

/** Bandeau d'accueil : aplat de marque (pas de dégradé) avec formes décoratives originales. */
export function HomeBanner({ name }: { name: string }) {
  const { t } = useI18n();
  const first = name.trim().split(/\s+/)[0] ?? '';
  return (
    <View style={styles.banner} accessible accessibilityRole="header" accessibilityLabel={t('home.greeting', { name: first })}>
      <View style={[styles.blob, styles.blobA]} />
      <View style={[styles.blob, styles.blobB]} />
      <Text variant="title" color={onMedia} style={styles.greet}>
        {t('home.greeting', { name: first })}
      </Text>
      <Text variant="small" color={onMedia} style={styles.sub}>
        {t('home.greetingSub')}
      </Text>
    </View>
  );
}

/** Titre de section avec lien « Voir plus » à droite (cible ≥ 44 pt). */
export function SectionHeader({ title, actionLabel, actionA11y, onAction }: { title: string; actionLabel?: string; actionA11y?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="link" accessibilityLabel={actionA11y ?? actionLabel} onPress={onAction} style={styles.seeMore}>
          <Text variant="small" color={colors.textMuted} style={{ fontWeight: '600' }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Carte vidéo du fil : fond uni sombre, badge « Vidéo » blanc sur le visuel, bouton lecture, auteur et texte dessous. */
export function VideoCard({ post }: { post: CachedPost }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.videoA11y', { name: post.author.displayName })}
      onPress={() => router.push({ pathname: '/post/[postId]', params: { postId: post.id } })}
      style={({ pressed }) => [styles.video, shadow.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.videoFrame}>
        <View style={styles.vBadge} importantForAccessibility="no-hide-descendants">
          <Text variant="caption" color="#111111">
            {t('home.video')}
          </Text>
        </View>
        <View style={styles.playDisc} importantForAccessibility="no-hide-descendants">
          <Ionicons name="play" size={26} color={onMedia} />
        </View>
      </View>
      <View style={styles.videoInfo}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {post.author.displayName}
        </Text>
        {post.body ? (
          <Text variant="small" muted numberOfLines={2}>
            {post.body}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Emplacement de promotion : ne reçoit que de vraies données (aucune source côté API pour l'instant). */
export function PromoCard({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.promo} accessible accessibilityLabel={body ? `${title}. ${body}` : title}>
      <Text variant="heading" color={onMedia}>
        {title}
      </Text>
      {body ? (
        <Text variant="small" color={onMedia}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.xl, minHeight: 124, borderRadius: radius.xxl, backgroundColor: brandColor, overflow: 'hidden', justifyContent: 'center', gap: spacing.xs },
  blob: { position: 'absolute', borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  blobA: { width: 150, height: 150, right: -40, top: -50 },
  blobB: { width: 90, height: 90, right: 50, bottom: -46 },
  greet: { maxWidth: '80%' },
  sub: { maxWidth: '70%' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, minHeight: TOUCH },
  seeMore: { minHeight: TOUCH, justifyContent: 'center', paddingLeft: spacing.md },
  video: { marginHorizontal: spacing.lg, marginVertical: spacing.sm, padding: spacing.sm, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  videoFrame: { height: 190, borderRadius: radius.lg, backgroundColor: '#1F1D3A', alignItems: 'center', justifyContent: 'center' },
  vBadge: { position: 'absolute', top: spacing.sm, left: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#FFFFFF' },
  playDisc: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  videoInfo: { padding: spacing.sm, gap: 2 },
  promo: { marginHorizontal: spacing.lg, marginVertical: spacing.sm, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: brandColor, gap: spacing.xs },
});
