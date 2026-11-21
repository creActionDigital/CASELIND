import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { fetchFlashSales, promoKeys } from '../promotions/api';
import { brandAccent, onMedia, radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, Text } from '../ui';
import { PressableScale } from '../ui/premium';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from './format';
import { categoryIcon } from './market-logic';

/** Bannière promo arrondie en carrousel (ventes flash en cours), bouton « Acheter » orange et points de pagination. Absente sans vente. */
export function ShopBanner() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const { status } = useAuth();
  const flash = useQuery({ queryKey: promoKeys.flash, queryFn: () => fetchFlashSales(undefined, 10), enabled: status === 'signedIn', staleTime: 60_000, retry: false });
  const items = (flash.data?.items ?? []).slice(0, 5);
  const [w, setW] = useState(0);
  const [page, setPage] = useState(0);
  if (items.length === 0) return null;
  const open = (id: string) => router.push({ pathname: '/product/[productId]', params: { productId: id } });
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ gap: spacing.sm }}>
      {w > 0 ? (
        <FlatList
          horizontal
          pagingEnabled
          data={items}
          keyExtractor={(p) => p.id}
          showsHorizontalScrollIndicator={false}
          onScroll={(e) => setPage(Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.x / w))))}
          scrollEventThrottle={32}
          renderItem={({ item: p }) => (
            <View style={{ width: w }}>
              <PressableScale onPress={() => open(p.id)} accessibilityLabel={`${p.promotion?.label ?? t('promo.flash.title')}. ${p.title}`} style={[styles.banner, { backgroundColor: colors.surfaceAlt }]}>
                <View style={styles.text}>
                  <Text variant="small" color={colors.textMuted} numberOfLines={1}>
                    {p.promotion?.label ?? t('promo.flash.title')}
                  </Text>
                  <Text variant="heading" numberOfLines={2}>
                    {p.title}
                  </Text>
                  <Text variant="bodyStrong" color={colors.text}>
                    {formatMoney(p.minPriceMinor, p.currency, locale)}
                  </Text>
                  <View style={styles.cta} importantForAccessibility="no-hide-descendants">
                    <Text color={onMedia} style={styles.ctaLabel}>
                      {t('product.buy')}
                    </Text>
                  </View>
                </View>
                <AuthImage contentUrl={p.coverUrl} label={p.title} style={styles.img} />
              </PressableScale>
            </View>
          )}
        />
      ) : null}
      {items.length > 1 ? (
        <View style={styles.dots} importantForAccessibility="no-hide-descendants">
          {items.map((p, i) => (
            <View key={p.id} style={[styles.dot, i === page ? { width: 18, backgroundColor: colors.text } : { borderWidth: 1, borderColor: colors.textMuted }]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Catégorie en rond (initiale dans un cercle clair) avec son libellé dessous. */
export function CategoryRound({ label, selected, onPress, all }: { label: string; selected: boolean; onPress: () => void; all?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={styles.cat}>
      <View style={[styles.circle, { backgroundColor: colors.surfaceAlt, borderColor: selected ? brandAccent : 'transparent' }]}>
        <Ionicons name={all ? 'apps-outline' : categoryIcon(label)} size={26} color={selected ? brandAccent : colors.primary} />
      </View>
      <Text variant="caption" numberOfLines={2} style={{ textAlign: 'center', fontWeight: selected ? '700' : '500' }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md, minHeight: 168, overflow: 'hidden' },
  text: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  img: { width: 120, height: 120, borderRadius: radius.lg, backgroundColor: 'transparent' },
  cta: { marginTop: spacing.xs, minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: brandAccent, alignItems: 'center', justifyContent: 'center' },
  ctaLabel: { fontSize: 18, lineHeight: 24, fontWeight: '700', fontFamily: 'Poppins_700Bold' },
  dots: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cat: { width: 76, alignItems: 'center', gap: spacing.xs },
  circle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
});
