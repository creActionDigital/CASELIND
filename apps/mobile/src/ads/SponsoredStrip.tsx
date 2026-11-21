import type { AdPlacement } from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { clickAd, fetchServed } from './api';

/** Annonces approuvées pour un emplacement (marketplace, recherche, vidéos), toujours marquées « Sponsorisé ». Rien si aucune. */
export function SponsoredStrip({ placement }: { placement: AdPlacement }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const q = useQuery({ queryKey: ['ads-served', placement], queryFn: () => fetchServed(placement, 2), staleTime: 120_000, retry: false });
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {items.map((a) => (
        <Pressable
          key={a.campaignId}
          accessibilityRole="button"
          accessibilityLabel={`${t('creator.sponsoredA11y')} : ${a.title}`}
          onPress={() => {
            void clickAd(a.campaignId).catch(() => undefined);
            if (a.productId) router.push({ pathname: '/product/[productId]', params: { productId: a.productId } });
            else if (a.postId) router.push({ pathname: '/post/[postId]', params: { postId: a.postId } });
          }}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text variant="caption" color={colors.primary} style={{ fontWeight: '700' }}>
            {t('creator.sponsored')}
          </Text>
          <Text numberOfLines={2}>{a.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: TOUCH, gap: 2 },
});
