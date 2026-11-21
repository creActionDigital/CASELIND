import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { FadeInView, PressableScale, SectionHeader } from '../ui/premium';
import { fetchCategories, fetchRecentProducts } from './api';
import { shopKeys } from './hooks';
import { categoryIcon } from './market-logic';
import { ProductCard } from './ProductGrid';

/** Rangées de l'accueil marketplace : catégories, lien promotions/coupons et recommandés (les ventes flash sont dans FlashStrip). */
export function MarketRows() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const cats = useQuery({ queryKey: shopKeys.categories, queryFn: fetchCategories, staleTime: 10 * 60_000 });
  const recs = useQuery({ queryKey: ['market-recommended'], queryFn: () => fetchRecentProducts(10), staleTime: 60_000 });
  return (
    <FadeInView style={styles.wrap}>
      <SectionHeader title={t('mc.home.categories')} actionLabel={t('mc.cat.seeAll')} onAction={() => router.push('/categories')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {(cats.data?.items ?? []).slice(0, 8).map((c) => (
          <PressableScale
            key={c.id}
            accessibilityLabel={t('mc.cat.open', { name: c.name })}
            onPress={() => router.push({ pathname: '/categories/[categoryId]', params: { categoryId: c.id, name: c.name } })}
            style={styles.cat}
          >
            <View style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name={categoryIcon(c.name)} size={26} color={colors.primary} />
            </View>
            <Text variant="caption" numberOfLines={1} style={styles.catLabel}>
              {c.name}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>
      <Pressable accessibilityRole="link" onPress={() => router.push('/deals')} style={styles.link}>
        <Text variant="small" color={colors.primary} style={styles.bold}>
          {t('mc.home.deals')}
        </Text>
      </Pressable>
      {recs.data && recs.data.items.length > 0 ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('mc.home.recommended')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {recs.data.items.map((p) => (
              <ProductCard key={p.id} product={p} width={156} />
            ))}
          </ScrollView>
        </>
      ) : null}
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { gap: spacing.md, paddingVertical: spacing.xs },
  link: { minHeight: TOUCH, justifyContent: 'center' },
  bold: { fontWeight: '600' },
  cat: { width: 72, alignItems: 'center', gap: spacing.xs },
  circle: { width: 56, height: 56, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  catLabel: { textAlign: 'center' },
});
