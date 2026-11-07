import type { SearchOrgHit, SearchPostHit, SearchProductHit, SearchUserHit } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { formatMoney } from '../shop/format';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Avatar, AuthImage, Text } from '../ui';

function Row({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
    >
      {children}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export const UserHitRow = memo(function UserHitRow({ hit }: { hit: SearchUserHit }) {
  const router = useRouter();
  return (
    <Row label={`${hit.displayName}, @${hit.handle}`} onPress={() => router.push({ pathname: '/user/[userId]', params: { userId: hit.id } })}>
      <Avatar name={hit.displayName} size={44} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {hit.displayName}
        </Text>
        <Text variant="small" muted numberOfLines={1}>
          @{hit.handle}
        </Text>
      </View>
    </Row>
  );
});

export const OrgHitRow = memo(function OrgHitRow({ hit }: { hit: SearchOrgHit }) {
  const router = useRouter();
  const { t } = useI18n();
  const kind = t(`seller.kind.${hit.kind}` as MessageKey);
  return (
    <Row label={`${hit.name}, ${kind}`} onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: hit.slug } })}>
      <AuthImage contentUrl={hit.logoUrl} label={hit.name} style={styles.thumb} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {hit.name}
        </Text>
        <Text variant="small" muted numberOfLines={1}>
          {[kind, hit.city, hit.verified ? t('search.verified') : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Row>
  );
});

export const ProductHitRow = memo(function ProductHitRow({ hit }: { hit: SearchProductHit }) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const price = formatMoney(hit.minPriceMinor, hit.currency, locale);
  return (
    <Row
      label={t('shop.productA11y', { title: hit.title, price, shop: hit.org.name })}
      onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: hit.id } })}
    >
      <AuthImage contentUrl={hit.coverUrl} label={hit.title} style={styles.thumb} />
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {hit.title}
        </Text>
        <Text variant="small" muted numberOfLines={1}>
          {t('shop.from', { price })} · {hit.org.name}
        </Text>
      </View>
    </Row>
  );
});

export const PostHitRow = memo(function PostHitRow({ hit }: { hit: SearchPostHit }) {
  const router = useRouter();
  return (
    <Row
      label={`${hit.authorDisplayName}: ${hit.snippet}`}
      onPress={() => router.push({ pathname: '/post/[postId]', params: { postId: hit.id } })}
    >
      <Avatar name={hit.authorDisplayName} size={44} />
      <View style={styles.flex}>
        <Text variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>
          {hit.authorDisplayName} · @{hit.authorHandle}
        </Text>
        <Text numberOfLines={2}>{hit.snippet}</Text>
      </View>
    </Row>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { minHeight: TOUCH + 20, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
});
