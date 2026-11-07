import { Ionicons } from '@expo/vector-icons';
import type { OpeningHours } from '@caselind/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { fetchStore, fetchStoreProducts } from '../../../shop/api';
import { shopKeys } from '../../../shop/hooks';
import { ContactSeller } from '../../../shop/ContactSeller';
import { ProductGrid } from '../../../shop/ProductGrid';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Avatar, ErrorState, Text } from '../../../ui';
import { ActivityIndicator } from 'react-native';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Vitrine publique d'une organisation : bannière, logo, nom, badge vérifié, horaires, produits. */
export default function StoreScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const s = String(slug);

  const store = useQuery({ queryKey: shopKeys.store(s), queryFn: () => fetchStore(s) });
  const products = useInfiniteQuery({
    queryKey: shopKeys.storeProducts(s),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchStoreProducts(s, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (store.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (store.isError) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <ErrorState error={store.error} onRetry={() => store.refetch()} />
      </View>
    );
  }
  const o = store.data;
  const header = (
    <View style={styles.header}>
      <View style={styles.bannerWrap}>
        <AuthImage contentUrl={o.bannerUrl} label={o.name} style={styles.banner} />
        <View style={[styles.logoWrap, { borderColor: colors.background, backgroundColor: colors.background }]}>
          {o.logoUrl ? <AuthImage contentUrl={o.logoUrl} label={o.name} style={styles.logo} /> : <Avatar name={o.name} size={72} />}
        </View>
      </View>
      <View style={styles.nameRow}>
        <Text variant="title" accessibilityRole="header" style={styles.flex} numberOfLines={2}>
          {o.name}
        </Text>
        {o.verified ? (
          <View style={styles.verified} accessible accessibilityLabel={t('shop.store.verified')}>
            <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
          </View>
        ) : null}
      </View>
      {o.city ? (
        <Text muted>
          {o.city}
          {o.country ? `, ${o.country}` : ''}
        </Text>
      ) : null}
      {o.description ? <Text>{o.description}</Text> : null}
      <ContactSeller contactUserId={o.contactUserId} />
      {o.openingHours ? <Hours hours={o.openingHours} /> : null}
      <Text variant="heading" accessibilityRole="header" style={{ marginTop: spacing.sm }}>
        {t('shop.store.products')}
      </Text>
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: o.name }} />
      <ProductGrid query={products} header={header} emptyTitle={t('shop.store.emptyTitle')} emptyBody={t('shop.store.emptyBody')} />
    </View>
  );
}

function Hours({ hours }: { hours: OpeningHours }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.hours, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {t('shop.store.hours')}
      </Text>
      {DAYS.map((d) => {
        const day = hours[d] ?? [];
        return (
          <View key={d} style={styles.dayRow}>
            <Text variant="small" style={styles.flex}>
              {t(`shop.day.${d}` as MessageKey)}
            </Text>
            <Text variant="small" muted>
              {day.length > 0 ? day.map((iv) => `${iv.open}–${iv.close}`).join(', ') : t('shop.store.closed')}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { gap: spacing.sm },
  bannerWrap: { marginBottom: 36 },
  banner: { width: '100%', height: 140, borderRadius: radius.lg },
  logoWrap: { position: 'absolute', left: spacing.md, bottom: -36, borderWidth: 4, borderRadius: radius.pill, overflow: 'hidden' },
  logo: { width: 72, height: 72, borderRadius: radius.pill },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  verified: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hours: { padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.xs },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
