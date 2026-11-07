import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../../../../lib/api';
import { useI18n, type MessageKey } from '../../../../i18n';
import { fetchOrders, fetchProducts, sk, useMyOrgs } from '../../../../seller/api';
import { can, canEditProfile, canReadCatalog, canViewReviews } from '../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { canViewFinance } from '../../../../wallet/org-access';
import { ErrorState, Text } from '../../../../ui';

type Icon = ComponentProps<typeof Ionicons>['name'];

/** Tableau de bord d'une organisation : sélecteur, compteurs, raccourcis (masqués selon le rôle). */
export default function SellerDashboard() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const orgs = useMyOrgs();
  const active = orgs.data?.items.filter((m) => m.status === 'active') ?? [];
  const current = active.find((m) => m.org.id === orgId);
  const role = current?.role;

  const pending = useQuery({
    queryKey: sk.count(orgId, 'pending-orders'),
    queryFn: () => fetchOrders(orgId, 'pending'),
    enabled: can(role, 'orders.view'),
  });
  const published = useQuery({
    queryKey: sk.count(orgId, 'published-products'),
    queryFn: () => fetchProducts(orgId, 'published'),
    enabled: canReadCatalog(role),
  });

  const title = <Stack.Screen options={{ title: current?.org.name ?? t('seller.title') }} />;
  if (orgs.isPending) return <>{title}<Loading /></>;
  if (orgs.isError) return <>{title}<ErrorState error={orgs.error} onRetry={() => orgs.refetch()} /></>;
  if (!current) return <>{title}<ErrorState error={new ApiRequestError(404, 'not_found', 'not found')} /></>;

  const more = (page?: { items: unknown[]; nextCursor: string | null }) => (page ? `${page.items.length}${page.nextCursor ? '+' : ''}` : '–');
  const outOfStock = published.data
    ? published.data.items.filter((p) => p.variants.some((v) => v.active && v.trackStock && v.stock <= 0)).length
    : null;

  const base = (path: string) => router.push(`/seller/${orgId}${path}` as never);
  const shortcuts: { icon: Icon; label: MessageKey; path: string; show: boolean }[] = [
    { icon: 'receipt-outline', label: 'seller.orders', path: '/orders', show: can(role, 'orders.view') },
    { icon: 'pricetags-outline', label: 'seller.products', path: '/products', show: can(role, 'catalog.manage') },
    { icon: 'layers-outline', label: 'seller.stock', path: '/stock', show: canReadCatalog(role) },
    { icon: 'ticket-outline', label: 'seller.coupons', path: '/coupons', show: can(role, 'orders.manage') },
    { icon: 'star-outline', label: 'seller.reviews', path: '/reviews', show: canViewReviews(role) },
    { icon: 'wallet-outline', label: 'wallet.org.card', path: '/wallet', show: canViewFinance(role) },
    { icon: 'location-outline', label: 'seller.location', path: '/location', show: canEditProfile(role) },
    { icon: 'qr-code-outline', label: 'sellerQr.title', path: '/qr', show: canViewFinance(role) || can(role, 'orders.manage') },
  ];

  return (
    <>
      {title}
      <ScrollView contentContainerStyle={{ paddingVertical: spacing.lg, gap: spacing.sm }}>
        {active.length > 1 ? (
          <Chips
            options={active.map((m) => ({ value: m.org.id, label: m.org.name }))}
            value={orgId}
            onChange={(id) => router.replace({ pathname: '/seller/[orgId]', params: { orgId: id } })}
          />
        ) : null}
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {current.org.status === 'suspended' ? (
            <Text variant="small" color={colors.danger}>
              {t('seller.suspendedNotice')}
            </Text>
          ) : null}
          <View style={styles.counters}>
            {can(role, 'orders.view') ? (
              <Counter
                label={t('seller.count.pending')}
                value={pending.isError ? '!' : more(pending.data)}
                loading={pending.isPending}
                onPress={() => base('/orders')}
              />
            ) : null}
            {canReadCatalog(role) ? (
              <>
                {can(role, 'catalog.manage') ? (
                  <Counter
                    label={t('seller.count.published')}
                    value={published.isError ? '!' : more(published.data)}
                    loading={published.isPending}
                    onPress={() => base('/products')}
                  />
                ) : null}
                <Counter
                  label={t('seller.count.outOfStock')}
                  value={published.isError ? '!' : outOfStock === null ? '–' : String(outOfStock)}
                  loading={published.isPending}
                  tone={outOfStock ? 'danger' : undefined}
                  onPress={() => base('/stock')}
                />
              </>
            ) : null}
          </View>

          <SectionTitle>{t('seller.shortcuts')}</SectionTitle>
          {shortcuts.filter((s) => s.show).map((s) => (
            <Card key={s.path} label={t(s.label)} onPress={() => base(s.path)}>
              <View style={styles.line}>
                <Ionicons name={s.icon} size={24} color={colors.primary} />
                <Text style={{ flex: 1 }}>{t(s.label)}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </View>
            </Card>
          ))}
          {!shortcuts.some((s) => s.show) ? <Text muted>{t('seller.noAccess')}</Text> : null}
        </View>
      </ScrollView>
    </>
  );
}

function Counter({
  label,
  value,
  loading,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  loading?: boolean;
  tone?: 'danger';
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Card style={styles.counter} label={`${label}: ${loading ? t('common.loading') : value}`} onPress={onPress}>
      <Text variant="title" color={tone === 'danger' ? colors.danger : colors.text}>
        {loading ? '…' : value}
      </Text>
      <Text variant="small" muted>
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  counters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  counter: { flexGrow: 1, flexBasis: 100, borderRadius: radius.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
