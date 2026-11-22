import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { fetchFlashSales, promoKeys } from '../promotions/api';
import { fonts, brandAccent, onMedia, radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, Text } from '../ui';
import { PressableScale } from '../ui/premium';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from './format';
import { categoryIcon } from './market-logic';

/** Bannière fixe CASELIND, utilisée quand aucune vente flash n'est en cours. */
const FIXED = [
  { key: 'new', title: 'mk.banner.new', sub: 'mk.banner.newSub', icon: 'sparkles-outline', to: '/deals' },
  { key: 'goma', title: 'mk.banner.goma', sub: 'mk.banner.gomaSub', icon: 'bicycle-outline', to: '/categories' },
] as const;

interface Slide {
  key: string;
  title: string;
  lead?: string;
  big?: string;
  coverUrl?: string | null;
  icon?: (typeof FIXED)[number]['icon'];
  onPress: () => void;
}

/** Grande bannière promo arrondie en carrousel : ventes flash en cours, sinon bannières CASELIND. Bouton « Acheter » orange et points. */
export function ShopBanner() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const { status } = useAuth();
  const flash = useQuery({ queryKey: promoKeys.flash, queryFn: () => fetchFlashSales(undefined, 10), enabled: status === 'signedIn', staleTime: 60_000, retry: false });
  const [w, setW] = useState(0);
  const [page, setPage] = useState(0);
  const flashItems = (flash.data?.items ?? []).slice(0, 5);
  const slides: Slide[] =
    flashItems.length > 0
      ? flashItems.map((p) => {
          const pct = p.compareAtPriceMinor ? Math.round(100 - (p.minPriceMinor / p.compareAtPriceMinor) * 100) : 0;
          return {
            key: p.id,
            title: p.title,
            lead: pct > 0 ? t('mk.banner.upTo') : undefined,
            big: pct > 0 ? `-${pct} %` : formatMoney(p.minPriceMinor, p.currency, locale),
            coverUrl: p.coverUrl,
            onPress: () => router.push({ pathname: '/product/[productId]', params: { productId: p.id } }),
          };
        })
      : FIXED.map((f) => ({ key: f.key, title: t(f.title), lead: t(f.sub), icon: f.icon, onPress: () => router.push(f.to) }));
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <FlatList
          horizontal
          pagingEnabled
          data={slides}
          keyExtractor={(s) => s.key}
          showsHorizontalScrollIndicator={false}
          onScroll={(e) => setPage(Math.max(0, Math.min(slides.length - 1, Math.round(e.nativeEvent.contentOffset.x / w))))}
          scrollEventThrottle={32}
          renderItem={({ item: s }) => (
            <View style={{ width: w }}>
              <PressableScale onPress={s.onPress} accessibilityLabel={`${s.title}. ${t('product.buy')}`} style={[styles.banner, { backgroundColor: colors.surfaceAlt }]}>
                <View style={styles.text}>
                  <Text numberOfLines={3} style={[styles.bTitle, { color: colors.text }]}>
                    {s.title}
                  </Text>
                  {s.lead ? (
                    <Text numberOfLines={2} style={[styles.bLead, { color: colors.text }]}>
                      {s.lead}
                    </Text>
                  ) : null}
                  {s.big ? (
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.bBig, { color: colors.text }]}>
                      {s.big}
                    </Text>
                  ) : null}
                  <View style={styles.cta} importantForAccessibility="no-hide-descendants">
                    <Text color={onMedia} style={styles.ctaLabel}>
                      {t('product.buy')}
                    </Text>
                  </View>
                </View>
                {s.icon ? (
                  <View style={styles.icon}>
                    <Ionicons name={s.icon} size={84} color={brandAccent} />
                  </View>
                ) : (
                  <AuthImage contentUrl={s.coverUrl ?? null} label={s.title} contentFit="contain" style={styles.img} />
                )}
              </PressableScale>
            </View>
          )}
        />
      ) : null}
      {slides.length > 1 ? (
        <View style={styles.dots} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          {slides.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === page ? { width: 14, backgroundColor: colors.text } : { borderWidth: 1, borderColor: colors.textMuted }]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Catégorie en rond (icône sur fond clair, sans anneau de sélection) avec son libellé sur 2 lignes maximum. */
export function CategoryRound({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={styles.cat}>
      <View style={[styles.circle, { backgroundColor: colors.surfaceAlt }]}>
        <Ionicons name={categoryIcon(label)} size={26} color={colors.text} />
      </View>
      <Text numberOfLines={2} style={[styles.catLabel, { color: colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.xl, paddingLeft: spacing.xl, paddingRight: spacing.sm, paddingVertical: spacing.lg, height: 172, overflow: 'hidden' },
  text: { flex: 1, gap: 2, alignItems: 'flex-start' },
  bTitle: { fontFamily: fonts.bold, fontWeight: '700', fontSize: 20, lineHeight: 26, letterSpacing: 0.3 },
  bLead: { fontFamily: fonts.semibold, fontWeight: '600', fontSize: 14, lineHeight: 18 },
  bBig: { fontFamily: fonts.extrabold, fontWeight: '800', fontSize: 30, lineHeight: 36 },
  img: { width: 130, height: 140, backgroundColor: 'transparent' },
  icon: { width: 120, alignItems: 'center', justifyContent: 'center' },
  cta: { marginTop: 6, height: 32, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: brandAccent, alignItems: 'center', justifyContent: 'center' },
  ctaLabel: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold },
  dots: { position: 'absolute', left: spacing.xl, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cat: { width: 72, alignItems: 'center', gap: 6 },
  circle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontFamily: fonts.medium, fontWeight: '500', fontSize: 11, lineHeight: 14, textAlign: 'center' },
});
