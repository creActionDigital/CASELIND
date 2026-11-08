import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SheetModal } from '../../components/SheetModal';
import { useI18n } from '../../i18n';
import { fetchCategories, fetchProducts, type ShopFilters } from '../../shop/api';
import { parseMajorToMinor } from '../../shop/format';
import { shopKeys } from '../../shop/hooks';
import { CategoryPill, Chip } from '../../shop/parts';
import { ProductGrid } from '../../shop/ProductGrid';
import { brandColor, fonts, onMedia, radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, TextField, Text } from '../../ui';

const CURRENCIES = ['USD', 'CDF'];
const SORTS = ['recent', 'price_asc', 'price_desc'] as const;

/** Boutique : recherche, catégories en pastilles, filtres et tri dans une feuille, grille à défilement infini. */
export default function Shop() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const params = useLocalSearchParams<{ q?: string }>();
  const [text, setText] = useState(typeof params.q === 'string' ? params.q : '');
  const [q, setQ] = useState(text.trim());
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [filters, setFilters] = useState<{ minPrice?: number; maxPrice?: number; currency?: string; sort: ShopFilters['sort'] }>({ sort: 'recent' });
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState({ min: '', max: '', currency: undefined as string | undefined, sort: 'recent' as ShopFilters['sort'] });

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);

  const categories = useQuery({ queryKey: shopKeys.categories, queryFn: fetchCategories, staleTime: 10 * 60_000 });
  const applied: ShopFilters = useMemo(() => ({ q: q || undefined, categoryId, ...filters }), [q, categoryId, filters]);
  const query = useInfiniteQuery({
    queryKey: shopKeys.products(applied),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchProducts(applied, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const activeFilters = (filters.minPrice !== undefined ? 1 : 0) + (filters.maxPrice !== undefined ? 1 : 0) + (filters.currency ? 1 : 0) + (filters.sort !== 'recent' ? 1 : 0);

  function openSheet() {
    const cur = filters.currency;
    const digitsOf = (n?: number) => (n === undefined ? '' : String(n / 100));
    setDraft({ min: digitsOf(filters.minPrice), max: digitsOf(filters.maxPrice), currency: cur, sort: filters.sort });
    setSheet(true);
  }
  function apply() {
    const cur = draft.currency;
    // Sans devise choisie, les bornes sont en unités mineures à 2 décimales (USD, CDF).
    const toMinor = (s: string) => (s.trim() ? parseMajorToMinor(s, cur ?? 'USD', locale) ?? undefined : undefined);
    setFilters({ minPrice: toMinor(draft.min), maxPrice: toMinor(draft.max), currency: cur, sort: draft.sort });
    setSheet(false);
  }

  const header = (
    <View style={styles.header}>
      <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          accessibilityLabel={t('shop.search')}
          placeholder={t('shop.search')}
          placeholderTextColor={colors.textMuted}
          value={text}
          onChangeText={setText}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: colors.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={activeFilters > 0 ? `${t('shop.filters')} (${activeFilters})` : t('shop.filters')}
          onPress={openSheet}
          style={[styles.filterBtn, { backgroundColor: activeFilters > 0 ? brandColor : colors.surfaceAlt }]}
        >
          <Ionicons name="options-outline" size={20} color={activeFilters > 0 ? onMedia : colors.text} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('shop.categories')}>
        <CategoryPill label={t('shop.all')} selected={!categoryId} onPress={() => setCategoryId(undefined)} />
        {categories.data?.items.map((c) => (
          <CategoryPill key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('shop.title') }} />
      <ProductGrid query={query} header={header} emptyTitle={t('shop.emptyTitle')} emptyBody={t('shop.emptyBody')} />
      <SheetModal visible={sheet} onClose={() => setSheet(false)}>
        <View style={{ gap: spacing.md }}>
          <Text variant="heading" accessibilityRole="header">
            {t('shop.filters')}
          </Text>
          <Text variant="bodyStrong">{t('shop.sort')}</Text>
          <View style={styles.wrap}>
            {SORTS.map((s) => (
              <Chip key={s} label={t(`shop.sort.${s}`)} selected={draft.sort === s} onPress={() => setDraft({ ...draft, sort: s })} />
            ))}
          </View>
          <Text variant="bodyStrong">{t('shop.currency')}</Text>
          <View style={styles.wrap}>
            <Chip label={t('shop.anyCurrency')} selected={!draft.currency} onPress={() => setDraft({ ...draft, currency: undefined })} />
            {CURRENCIES.map((c) => (
              <Chip key={c} label={c} selected={draft.currency === c} onPress={() => setDraft({ ...draft, currency: c })} />
            ))}
          </View>
          <Text variant="bodyStrong">{t('shop.price')}</Text>
          <View style={styles.priceRow}>
            <View style={styles.flex}>
              <TextField label={t('shop.minPrice')} value={draft.min} onChangeText={(v) => setDraft({ ...draft, min: v })} keyboardType="decimal-pad" />
            </View>
            <View style={styles.flex}>
              <TextField label={t('shop.maxPrice')} value={draft.max} onChangeText={(v) => setDraft({ ...draft, max: v })} keyboardType="decimal-pad" />
            </View>
          </View>
          <Button label={t('shop.apply')} onPress={apply} />
          <Button variant="ghost" label={t('shop.reset')} onPress={() => setDraft({ min: '', max: '', currency: undefined, sort: 'recent' })} />
        </View>
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingLeft: spacing.lg, paddingRight: spacing.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: TOUCH, fontFamily: fonts.regular, fontSize: 16 },
  filterBtn: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: spacing.sm, paddingBottom: spacing.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  priceRow: { flexDirection: 'row', gap: spacing.md },
});
