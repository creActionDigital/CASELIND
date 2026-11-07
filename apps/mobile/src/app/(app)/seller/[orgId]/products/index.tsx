import type { Product, ProductStatus } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { fetchProducts, sk, useMembership } from '../../../../../seller/api';
import { formatMinor } from '../../../../../seller/money';
import { can } from '../../../../../seller/permissions';
import { Card, Chips, PagedList } from '../../../../../seller/ui';
import { radius, spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { AuthImage, Badge, IconButton, Text } from '../../../../../ui';

type Filter = ProductStatus | 'all';

/** Produits de l'organisation, filtrés par statut (brouillon / publié / archivé). */
export default function SellerProducts() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role } = useMembership(orgId);
  const [filter, setFilter] = useState<Filter>('published');
  const canEdit = can(role, 'catalog.manage');

  const q = useInfiniteQuery({
    queryKey: [...sk.products(orgId), filter],
    queryFn: ({ pageParam }) => fetchProducts(orgId, filter === 'all' ? undefined : filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const open = (id: string) => router.push({ pathname: '/seller/[orgId]/products/[productId]', params: { orgId, productId: id } });

  return (
    <>
      <Stack.Screen
        options={{
          title: t('seller.products'),
          headerRight: () => (canEdit ? <IconButton icon="add" label={t('seller.product.new')} onPress={() => open('new')} /> : null),
        }}
      />
      <PagedList<Product>
        query={q}
        keyExtractor={(p) => p.id}
        header={
          <Chips
            options={(['all', 'draft', 'published', 'archived'] as Filter[]).map((f) => ({ value: f, label: t(`seller.filter.${f}` as MessageKey) }))}
            value={filter}
            onChange={setFilter}
          />
        }
        empty={{
          icon: 'pricetags-outline',
          title: t('seller.products.emptyTitle'),
          body: t('seller.products.emptyBody'),
          actionLabel: canEdit ? t('seller.product.new') : undefined,
          onAction: canEdit ? () => open('new') : undefined,
        }}
        renderItem={({ item: p }) => {
          const prices = p.variants.filter((v) => v.active).map((v) => v.priceMinor);
          const currency = p.variants[0]?.currency ?? 'USD';
          const stock = p.variants.filter((v) => v.trackStock).reduce((n, v) => n + v.stock, 0);
          const out = p.variants.some((v) => v.active && v.trackStock && v.stock <= 0);
          const price =
            prices.length === 0
              ? '–'
              : Math.min(...prices) === Math.max(...prices)
                ? formatMinor(prices[0], currency, locale)
                : `${formatMinor(Math.min(...prices), currency, locale)} – ${formatMinor(Math.max(...prices), currency, locale)}`;
          return (
            <Card label={p.title} onPress={() => open(p.id)}>
              <View style={styles.row}>
                <View style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}>
                  {p.media[0] ? <AuthImage contentUrl={p.media[0].contentUrl} label={p.title} style={StyleSheet.absoluteFill} /> : null}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {p.title}
                  </Text>
                  <Text variant="small" muted>
                    {price} · {t('seller.product.variantsCount', { n: p.variants.length })}
                  </Text>
                  <Text variant="small" color={out ? colors.danger : colors.textMuted}>
                    {out ? t('seller.product.outOfStock') : t('seller.product.stockTotal', { n: stock })}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                  <Badge tone={p.status === 'published' ? 'primary' : 'neutral'} label={t(`seller.filter.${p.status}` as MessageKey)} />
                  {p.hidden ? <Badge tone="accent" label={t('seller.product.hidden')} /> : null}
                </View>
              </View>
            </Card>
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, overflow: 'hidden' },
});
