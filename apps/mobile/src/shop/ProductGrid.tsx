import type { StorefrontProduct } from '@caselind/contracts';
import type { UseInfiniteQueryResult, InfiniteData } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { fonts, brandAccent, onMedia, radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, EmptyState, ErrorState, Text } from '../ui';
import { PromoBadge, PromoPrice } from '../promotions/parts';
import { useToggleWishFromCard, useWishedIds } from '../promotions/hooks';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from './format';
import { swatchColor } from './swatch';

/** Pastilles rondes des couleurs du produit (3 au plus, puis « +N »). Nom inconnu : rond gris clair. */
function ColorDots({ colors: names }: { colors?: string[] }) {
  const { colors } = useTheme();
  if (!names || names.length === 0) return null;
  const shown = names.slice(0, 3);
  return (
    <View style={styles.dots} importantForAccessibility="no-hide-descendants">
      {shown.map((n) => (
        <View key={n} style={[styles.dot, { backgroundColor: swatchColor(n) ?? '#D1D1D6', borderColor: colors.border }]} />
      ))}
      {names.length > shown.length ? (
        <View style={[styles.dot, styles.more, { borderColor: colors.textMuted }]}>
          <Text style={[styles.moreText, { color: colors.textMuted }]}>+{names.length - shown.length}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Carte produit : fond gris arrondi, image contenue et centrée, onglet orange avec cœur dans le coin haut-droit (rien ne dépasse), nom, prix et pastilles de couleur. */
export const ProductCard = memo(function ProductCard({ product, width }: { product: StorefrontProduct; width?: number }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const price = formatMoney(product.minPriceMinor, product.currency, locale);
  const wished = useWishedIds().has(product.id);
  const wish = useToggleWishFromCard();
  const promo = !!product.compareAtPriceMinor && product.compareAtPriceMinor > product.minPriceMinor;
  return (
    // Le cœur est un frère du bouton de la carte (pas de bouton dans un bouton) ; le conteneur arrondi le garde dans le coin.
    <View style={[styles.card, { width, backgroundColor: colors.surfaceAlt }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('shop.productA11y', { title: product.title, price, shop: product.org.name })}
        onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: product.id } })}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <View style={styles.imageBox}>
          <AuthImage contentUrl={product.coverUrl} label={product.title} contentFit="contain" style={styles.image} />
          <View style={styles.promo} pointerEvents="none">
            <PromoBadge priceMinor={product.minPriceMinor} compareAtMinor={product.compareAtPriceMinor} />
          </View>
          {product.inStock ? null : (
            <View style={styles.badge} importantForAccessibility="no-hide-descendants">
              <Text variant="caption" color={onMedia}>
                {t('shop.outOfStock')}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.info}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
            {product.title}
          </Text>
          <View style={styles.priceRow}>
            {promo ? (
              <PromoPrice priceMinor={product.minPriceMinor} compareAtMinor={product.compareAtPriceMinor} currency={product.currency} />
            ) : (
              <Text numberOfLines={1} style={[styles.price, { color: colors.text }]}>
                {price}
              </Text>
            )}
            <ColorDots colors={product.colors} />
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(wished ? 'wish.remove' : 'wish.add')}
        accessibilityState={{ selected: wished }}
        hitSlop={6}
        onPress={() => wish.mutate({ productId: product.id, wish: !wished })}
        style={styles.heart}
      >
        <Ionicons name={wished ? 'heart' : 'heart-outline'} size={20} color={onMedia} />
      </Pressable>
    </View>
  );
});

interface Props {
  query: UseInfiniteQueryResult<InfiniteData<{ items: StorefrontProduct[]; nextCursor: string | null }>, Error>;
  header?: ReactElement;
  emptyTitle: string;
  emptyBody: string;
  /** Bloc affiché sous la grille (ex. questions fréquentes de la vitrine). */
  footer?: ReactElement;
  /** Sans produit : ni message ni grille (vitrine d'une organisation qui ne vend rien). */
  hideWhenEmpty?: boolean;
}

/** Grille 2 colonnes à défilement infini, avec les 5 états (chargement, erreur, vide, rafraîchissement, page suivante). */
export function ProductGrid({ query, header, emptyTitle, emptyBody, footer, hideWhenEmpty }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  let state: ReactElement | undefined;
  if (query.isPending) state = <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />;
  else if (query.isError && items.length === 0) state = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else if (items.length === 0 && !hideWhenEmpty) state = <EmptyState icon="bag-handle-outline" title={emptyTitle} body={emptyBody} />;

  return (
    <FlatList
      data={state ? [] : items}
      keyExtractor={(p) => p.id}
      numColumns={2}
      columnWrapperStyle={styles.columns}
      contentContainerStyle={styles.content}
      ListHeaderComponent={header}
      ListEmptyComponent={state}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.primary}
          onRefresh={async () => {
            setRefreshing(true);
            await query.refetch();
            setRefreshing(false);
          }}
        />
      }
      ListFooterComponent={
        <>
          {query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
          {footer}
        </>
      }
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
      onEndReachedThreshold={0.5}
      renderItem={({ item }) => (
        <View style={styles.cell}>
          <ProductCard product={item} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1, paddingBottom: spacing.xxl },
  columns: { gap: spacing.md },
  cell: { flex: 1, maxWidth: '50%' },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  imageBox: { height: 148, padding: spacing.md },
  image: { flex: 1, backgroundColor: 'transparent' },
  badge: { position: 'absolute', top: spacing.sm, left: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.72)' },
  promo: { position: 'absolute', bottom: spacing.xs, left: spacing.sm },
  heart: { position: 'absolute', top: 0, right: 0, width: 36, height: 36, borderBottomLeftRadius: 14, backgroundColor: brandAccent, alignItems: 'center', justifyContent: 'center' },
  info: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: 4 },
  name: { fontFamily: fonts.semibold, fontWeight: '600', fontSize: 14, lineHeight: 20 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  price: { fontFamily: fonts.bold, fontWeight: '700', fontSize: 16, lineHeight: 24, flexShrink: 1 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  more: { backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 6, lineHeight: 9, fontFamily: fonts.semibold },
});
