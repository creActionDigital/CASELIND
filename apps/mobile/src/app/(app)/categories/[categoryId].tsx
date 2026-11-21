import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { fetchProducts, type ShopFilters } from '../../../shop/api';
import { priceBounds } from '../../../shop/market-logic';
import { shopKeys } from '../../../shop/hooks';
import { Chip } from '../../../shop/parts';
import { ProductGrid } from '../../../shop/ProductGrid';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Text, TextField } from '../../../ui';

const SORTS = ['recent', 'price_asc', 'price_desc'] as const;
const CURRENCIES = ['USD', 'CDF'];

/** Page d'une catégorie : produits à défilement infini, tri, devise et fourchette de prix. */
export default function CategoryPage() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { categoryId, name } = useLocalSearchParams<{ categoryId: string; name?: string }>();
  const [sort, setSort] = useState<ShopFilters['sort']>('recent');
  const [currency, setCurrency] = useState<string | undefined>();
  const [draft, setDraft] = useState({ min: '', max: '' });
  const [bounds, setBounds] = useState<{ minPrice?: number; maxPrice?: number }>({});
  const [bad, setBad] = useState(false);

  const applied: ShopFilters = useMemo(() => ({ categoryId: String(categoryId), sort, currency, ...bounds }), [categoryId, sort, currency, bounds]);
  const query = useInfiniteQuery({
    queryKey: shopKeys.products(applied),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchProducts(applied, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  function apply() {
    const b = priceBounds({ ...draft, currency }, locale);
    setBad(b === 'invalid');
    if (b !== 'invalid') setBounds(b);
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.wrap}>
        {SORTS.map((s) => (
          <Chip key={s} label={t(`shop.sort.${s}` as MessageKey)} selected={sort === s} onPress={() => setSort(s)} />
        ))}
      </View>
      <View style={styles.wrap}>
        <Chip label={t('shop.anyCurrency')} selected={!currency} onPress={() => setCurrency(undefined)} />
        {CURRENCIES.map((c) => (
          <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
        ))}
      </View>
      <View style={styles.wrap}>
        <View style={styles.flex}>
          <TextField label={t('shop.minPrice')} value={draft.min} onChangeText={(v) => setDraft({ ...draft, min: v })} maxLength={12} keyboardType="decimal-pad" />
        </View>
        <View style={styles.flex}>
          <TextField label={t('shop.maxPrice')} value={draft.max} onChangeText={(v) => setDraft({ ...draft, max: v })} maxLength={12} keyboardType="decimal-pad" />
        </View>
      </View>
      {bad ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {t('mc.cat.badPrice')}
        </Text>
      ) : null}
      <Button variant="secondary" label={t('mc.cat.applyFilters')} onPress={apply} />
    </View>
  );

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: name || t('mc.cat.title') }} />
      <ProductGrid query={query} header={header} emptyTitle={t('mc.cat.resultsEmpty')} emptyBody={t('mc.cat.resultsEmptyBody')} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
