import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../../../../lib/api';
import { useI18n, type MessageKey } from '../../../../i18n';
import { fetchOrders, fetchProducts, sk, useMyOrgs } from '../../../../seller/api';
import { can, canEditProfile, canManageHr, canManageInventory, canReadCatalog, canViewReviews } from '../../../../seller/permissions';
import { canManageWebhooks } from '../../../../webhooks/logic';
import { SalesGlance } from '../../../../seller/SalesGlance';
import { splitBySector } from '../../../../business/sector';
import { canViewTeam } from '../../../../seller/team-logic';
import { Card, Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { canManageJobs } from '../../../../jobs/logic';
import { canViewFinance } from '../../../../wallet/org-access';
import { ErrorState, Text } from '../../../../ui';
import { ServiceGrid } from '../../../../ui/premium';

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
    { icon: 'navigate-outline', label: 'odel.title', path: '/deliveries', show: can(role, 'orders.view') },
    { icon: 'bicycle-outline', label: 'delivery.zones.title', path: '/zones', show: can(role, 'orders.manage') },
    { icon: 'stats-chart-outline', label: 'sales.title', path: '/sales', show: can(role, 'orders.view') },
    { icon: 'document-text-outline', label: 'docs.title', path: '/documents', show: can(role, 'orders.view') },
    { icon: 'school-outline', label: 'school.staff.title', path: '/school', show: current.org.kind === 'school' && (role === 'owner' || role === 'admin') },
    { icon: 'people-outline', label: 'customers.title', path: '/customers', show: can(role, 'orders.view') },
    { icon: 'cash-outline', label: 'pos.title', path: '/pos', show: can(role, 'orders.manage') },
    { icon: 'heart-outline', label: 'loyalty.seller.title', path: '/loyalty', show: can(role, 'orders.manage') },
    { icon: 'megaphone-outline', label: 'campaign.title', path: '/campaigns', show: can(role, 'orders.manage') },
    { icon: 'star-outline', label: 'seller.reviews', path: '/reviews', show: canViewReviews(role) },
    { icon: 'wallet-outline', label: 'wallet.org.card', path: '/wallet', show: canViewFinance(role) },
    { icon: 'construct-outline', label: 'services.pro.orgServices', path: '/services', show: current.org.kind === 'services' && can(role, 'catalog.manage') },
    { icon: 'briefcase-outline', label: 'jobs.org.title', path: '/jobs', show: canManageJobs(role) },
    { icon: 'storefront-outline', label: 'vitrine.title', path: '/vitrine', show: canEditProfile(role) },
    { icon: 'newspaper-outline', label: 'vitrine.updates.title', path: '/updates', show: canEditProfile(role) },
    { icon: 'help-circle-outline', label: 'vitrine.questions.seller.title', path: '/questions', show: canEditProfile(role) },
    { icon: 'location-outline', label: 'seller.location', path: '/location', show: canEditProfile(role) },
    { icon: 'return-down-back-outline', label: 'returns.tile', path: '/returns', show: can(role, 'orders.manage') },
    { icon: 'pricetag-outline', label: 'seller.promo.title', path: '/promotions', show: can(role, 'catalog.manage') },
    { icon: 'cart-outline', label: 'biz.purchasing.title', path: '/purchasing', show: can(role, 'inventory.manage') },
    { icon: 'wallet-outline', label: 'biz.expenses.title', path: '/expenses', show: can(role, 'finance.view') },
    { icon: 'trending-up-outline', label: 'biz.profit.title', path: '/profitability', show: can(role, 'finance.view') },
    { icon: 'people-circle-outline', label: 'hr.title', path: '/hr', show: canManageHr(role) },
    { icon: 'hourglass-outline', label: 'inv.batches.title', path: '/batches', show: canManageInventory(role) },
    { icon: 'clipboard-outline', label: 'inv.count.title', path: '/inventory', show: canManageInventory(role) },
    { icon: 'receipt-outline', label: 'ops2.comm.sellerTitle', path: '/commissions', show: canViewFinance(role) },
    { icon: 'car-sport-outline', label: 'rentals.org.title', path: '/rentals', show: can(role, 'catalog.manage') },
    { icon: 'git-network-outline', label: 'webhooks.title', path: '/webhooks', show: canManageWebhooks(role) },
    { icon: 'qr-code-outline', label: 'sellerQr.title', path: '/qr', show: canViewFinance(role) || can(role, 'orders.manage') },
    { icon: 'people-outline', label: 'mc.team.title', path: '/team', show: canViewTeam(role) },
  ];
  const { core, others } = splitBySector(current.org.kind, shortcuts.filter((s) => s.show));
  const renderGrid = (list: typeof shortcuts) => <ServiceGrid items={list.map((s) => ({ id: s.path, icon: s.icon, label: t(s.label), onPress: () => base(s.path) }))} />;

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

          {can(role, 'orders.view') ? <SalesGlance orgId={orgId} /> : null}
          <SectionTitle>{t('seller.shortcuts')}</SectionTitle>
          {core.length > 0 ? <SectionTitle>{t('mc.sector.title', { kind: t(`seller.kind.${current.org.kind}` as MessageKey) })}</SectionTitle> : null}
          {core.length > 0 ? renderGrid(core) : null}
          {core.length > 0 && others.length > 0 ? <SectionTitle>{t('mc.sector.others')}</SectionTitle> : null}
          {others.length > 0 ? renderGrid(others) : null}
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
