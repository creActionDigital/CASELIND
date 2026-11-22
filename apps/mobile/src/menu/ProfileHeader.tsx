import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { fetchProfile, fetchStats, fetchUserPosts } from '../social/api';
import { sk } from '../social/keys';
import { brandAccent, fonts, radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, Avatar, Button, Text } from '../ui';

interface Props {
  userId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null | undefined;
  /** `undefined` tant que l'API Premium n'a pas répondu. */
  premium: boolean | undefined;
  go: (href: string) => void;
}

const PREVIEW = 6;

/** En-tête de profil social du menu : couverture, avatar, bio, compteurs, actions et aperçu des publications (API sociale existante). */
export function ProfileHeader({ userId, displayName, handle, avatarUrl, premium, go }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const profile = useQuery({ queryKey: sk.profile(userId), queryFn: () => fetchProfile(userId) });
  const stats = useQuery({ queryKey: sk.stats(userId), queryFn: () => fetchStats(userId) });
  const posts = useQuery({ queryKey: [...sk.userPosts(userId), 'menu'], queryFn: () => fetchUserPosts(userId) });
  const withMedia = (posts.data?.items ?? []).filter((p) => p.media.length > 0).slice(0, PREVIEW);
  const bio = profile.data?.bio;
  // L'API ne fournit pas de total : exact tant que la première page n'est pas pleine, sinon « 20+ ».
  const total = posts.data ? `${posts.data.items.length}${posts.data.nextCursor ? '+' : ''}` : '–';

  const count = (n: string | number, label: string, href?: string) => (
    <Pressable accessibilityRole={href ? 'button' : 'text'} accessibilityLabel={`${n} ${label}`} disabled={!href} onPress={() => href && go(href)} style={styles.count}>
      <Text variant="heading">{n}</Text>
      <Text variant="caption" muted numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Couverture : aplat de marque (pas d'image de couverture côté API), l'avatar la chevauche. */}
      <View style={[styles.cover, { backgroundColor: colors.primary }]} importantForAccessibility="no-hide-descendants" />
      <View style={styles.body}>
        <View style={[styles.ring, { backgroundColor: colors.surface }]}>
          <Avatar name={displayName} size={88} contentUrl={avatarUrl} />
        </View>
        <Text variant="title" style={styles.center} numberOfLines={2}>
          {displayName}
        </Text>
        <Text muted>@{handle}</Text>
        {premium ? (
          <View accessible accessibilityLabel={t('mon.premium.badgeA11y')} style={[styles.badge, { backgroundColor: brandAccent }]}>
            <Ionicons name="ribbon" size={13} color={colors.onAccent} />
            <Text variant="caption" color={colors.onAccent} style={{ fontFamily: fonts.bold }}>
              {t('mon.premium.badge')}
            </Text>
          </View>
        ) : null}
        <Text style={styles.center} muted={!bio}>
          {bio ?? t('profile.social.noBio')}
        </Text>
        <View style={styles.counts}>
          {count(total, t('profile.social.posts'))}
          {count(stats.data?.followersCount ?? '–', t('profile.social.followers'), `/user/${userId}/followers`)}
          {count(stats.data?.followingCount ?? '–', t('profile.social.followingLabel'), `/user/${userId}/following`)}
        </View>
        <View style={styles.actions}>
          <Button label={t('menu.editProfile')} variant="secondary" onPress={() => go('/profile')} />
          <Button label={t('menu.viewPublic')} variant="secondary" onPress={() => go(`/user/${userId}`)} />
        </View>
      </View>
      <View style={[styles.previewHead, { borderTopColor: colors.border }]}>
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {t('profile.social.posts')}
        </Text>
        <Pressable accessibilityRole="link" accessibilityLabel={`${t('menu.seeAll')}, ${t('profile.social.posts')}`} onPress={() => go(`/user/${userId}`)} style={styles.seeAll}>
          <Text variant="small" color={colors.primary} style={{ fontFamily: fonts.semibold }}>
            {t('menu.seeAll')}
          </Text>
        </Pressable>
      </View>
      {withMedia.length > 0 ? (
        <View style={styles.grid}>
          {withMedia.map((p) => {
            const m = p.media[0]!;
            const video = (m.mime ?? '').startsWith('video');
            return (
              <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={p.body ?? t('profile.social.posts')} onPress={() => go(`/post/${p.id}`)} style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}>
                {video ? (
                  <View style={styles.center2}>
                    <Ionicons name="play-circle" size={30} color={colors.primary} />
                  </View>
                ) : (
                  <AuthImage contentUrl={m.contentUrl} label={p.body ?? ''} style={StyleSheet.absoluteFill} />
                )}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text muted style={styles.empty}>
          {posts.isPending ? '' : t('profile.social.noPostsMine')}
        </Text>
      )}
    </View>
  );
}

const GAP = 3;
const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cover: { height: 96 },
  body: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  ring: { marginTop: -44, padding: 4, borderRadius: radius.pill },
  center: { textAlign: 'center' },
  center2: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.md },
  counts: { flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-around', marginVertical: spacing.sm },
  count: { minHeight: TOUCH, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
  actions: { alignSelf: 'stretch', gap: spacing.sm },
  previewHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, minHeight: TOUCH + spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  seeAll: { minHeight: TOUCH, justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  thumb: { width: '32.8%', aspectRatio: 1, overflow: 'hidden' },
  empty: { textAlign: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.md },
});
