import { Ionicons } from '@expo/vector-icons';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View, type ListRenderItem, type StyleProp, type ViewStyle } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useI18n, type MessageKey } from '../i18n';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Badge, Button, EmptyState, ErrorState, Text } from '../ui';

/** Carte blanche arrondie, pressable si `onPress` est fourni (cible ≥ 44 pt). */
export function Card({
  children,
  onPress,
  label,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const base = [styles.card, { backgroundColor: colors.surface }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [...base, { opacity: pressed ? 0.85 : 1, minHeight: TOUCH }]}
    >
      {children}
    </Pressable>
  );
}

/** Sélecteur horizontal à puces (filtres, onglets de statut, choix de devise…). */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  scroll = true,
  flush = false,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  scroll?: boolean;
  /** Sans marge latérale propre : à utiliser dans un conteneur déjà rempli. */
  flush?: boolean;
}) {
  const { colors } = useTheme();
  const row = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable
        key={o.value}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={o.label}
        onPress={() => onChange(o.value)}
        style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}
      >
        <Text variant="small" color={on ? colors.onPrimary : colors.text} style={{ fontWeight: '600' }}>
          {o.label}
        </Text>
      </Pressable>
    );
  });
  if (!scroll) return <View style={styles.chipWrap}>{row}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={[styles.chipRow, flush && { paddingHorizontal: 0 }]}>
      {row}
    </ScrollView>
  );
}

export function Loading() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text variant="heading" accessibilityRole="header" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
      {children}
    </Text>
  );
}

const STATUS_TONE = { pending: 'accent', confirmed: 'primary', preparing: 'primary', shipped: 'primary', delivered: 'neutral', cancelled: 'neutral' } as const;
export function OrderStatusBadge({ status }: { status: keyof typeof STATUS_TONE }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]} label={t(`seller.status.${status}` as MessageKey)} />;
}

export function Stars({ rating }: { rating: number }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessible accessibilityLabel={t('seller.reviews.rating', { n: rating })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= rating ? 'star' : 'star-outline'} size={16} color={colors.primary} />
      ))}
    </View>
  );
}

type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * Liste paginée avec les 5 états : chargement, erreur (réessayer), vide, données, erreur de page suivante.
 * `header` reste affiché dans tous les états (filtres).
 */
export function PagedList<T>({
  query,
  keyExtractor,
  renderItem,
  header,
  empty,
  transform,
}: {
  query: UseInfiniteQueryResult<InfiniteData<Page<T>>>;
  keyExtractor: (item: T) => string;
  renderItem: ListRenderItem<T>;
  header?: ReactNode;
  empty: { icon?: ComponentProps<typeof Ionicons>['name']; title: string; body?: string; actionLabel?: string; onAction?: () => void };
  transform?: (items: T[]) => T[];
}) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  let body: ReactNode;
  if (query.isPending) body = <Loading />;
  else if (query.isError && !query.data) body = <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  else {
    const raw = (query.data?.pages ?? []).flatMap((p) => p.items);
    const items = transform ? transform(raw) : raw;
    body =
      items.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => query.refetch()}
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          ListFooterComponent={
            query.isFetchNextPageError ? (
              <View style={{ alignItems: 'center', gap: spacing.sm }}>
                <Text variant="small" color={colors.danger}>
                  {errorMessage(query.error, t, locale)}
                </Text>
                <Button variant="ghost" label={t('common.retry')} onPress={() => query.fetchNextPage()} />
              </View>
            ) : query.isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} />
            ) : query.hasNextPage ? (
              <Button variant="ghost" label={t('story.viewer.more')} onPress={() => query.fetchNextPage()} />
            ) : undefined
          }
        />
      );
  }
  return (
    <View style={{ flex: 1 }}>
      {header}
      {body}
    </View>
  );
}

/** Message d'erreur localisé, avec les cas 409 propres au vendeur (statut de commande, pas assez de stock…). */
export function sellerErrorMessage(err: unknown, t: (k: MessageKey, p?: Record<string, string | number>) => string, locale: string): string {
  if (err instanceof ApiRequestError && err.status === 409) {
    const reason = err.detail<string>('reason');
    if (reason === 'invalid_transition') return t('seller.error.invalidTransition');
    if (reason === 'stock_negative') return t('seller.error.stockNegative');
    if (reason === 'stock_not_tracked') return t('seller.error.stockNotTracked');
    if (reason === 'publish_without_variant') return t('seller.product.errNoVariant');
    if (reason === 'sku_taken') return t('seller.variant.err.sku_taken');
    if (reason === 'duplicate_sku_in_request') return t('seller.variant.err.sku_duplicate');
    if (reason === 'code_taken') return t('seller.error.codeTaken');
    if (reason === 'owner_limit') return t('seller.error.ownerLimit');
    if (/negative/i.test(err.message)) return t('seller.error.stockNegative');
    if (/not tracked/i.test(err.message)) return t('seller.error.stockNotTracked');
  }
  return errorMessage(err, t, locale);
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  chipScroll: { flexGrow: 0 },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chip: {
    minHeight: TOUCH,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
});
