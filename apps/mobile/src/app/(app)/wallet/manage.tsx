import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { sk, fetchMyOrgs } from '../../../seller/api';
import { formatMoney } from '../../../shop/format';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Screen, Text } from '../../../ui';
import { useKyc } from '../../../wallet/hooks';
import { canViewFinance } from '../../../wallet/org-access';
import { SandboxBanner } from '../../../wallet/ui';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Gérer : uniquement ce qui existe (PIN, KYC, recharge de test, QR, wallet de boutique) ; le reste est « bientôt ». */
export default function WalletManage() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const kyc = useKyc();
  const orgs = useQuery({ queryKey: sk.myOrgs, queryFn: fetchMyOrgs });
  const shops = (orgs.data?.items ?? []).filter((m) => m.status === 'active' && canViewFinance(m.role));
  const shopPath = shops.length === 1 ? ({ pathname: '/seller/[orgId]/wallet', params: { orgId: shops[0]!.org.id } } as const) : null;

  const tiles: { icon: IconName; label: MessageKey; hint?: string; onPress?: () => void }[] = [
    {
      icon: 'keypad-outline',
      label: 'wallet.pin.manage',
      hint: kyc.data ? t(kyc.data.hasPaymentPin ? 'wallet.pin.isSet' : 'wallet.pin.isNotSet') : undefined,
      onPress: () => router.push('/wallet/pin'),
    },
    { icon: 'id-card-outline', label: 'wallet.manage.kyc', hint: kyc.data ? t('wallet.kyc.level', { n: kyc.data.level }) : undefined, onPress: () => router.push('/kyc') },
    { icon: 'add-circle-outline', label: 'wallet.action.topup', onPress: () => router.push('/wallet/topup') },
    { icon: 'qr-code-outline', label: 'wallet.manage.qr', onPress: () => router.push('/wallet/receive') },
    { icon: 'pie-chart-outline', label: 'wallet.finance.title', onPress: () => router.push('/wallet/finance') },
    ...(shops.length > 0
      ? [{ icon: 'storefront-outline' as IconName, label: 'wallet.manage.shop' as MessageKey, onPress: () => (shopPath ? router.push(shopPath) : router.push('/seller')) }]
      : []),
    { icon: 'save-outline', label: 'wallet.manage.savings' },
    { icon: 'gift-outline', label: 'wallet.manage.rewards' },
    { icon: 'receipt-outline', label: 'wallet.manage.bills' },
  ];

  return (
    <Screen>
      <Stack.Screen options={{ title: t('wallet.manage.title') }} />
      <View style={{ gap: spacing.lg }}>
        <SandboxBanner />
        <View style={styles.grid}>
          {tiles.map((x) => {
            const soon = !x.onPress;
            const name = t(x.label);
            return (
              <Pressable
                key={x.label}
                accessibilityRole="button"
                accessibilityLabel={soon ? `${name}. ${t('common.soon')}` : name}
                accessibilityState={{ disabled: soon }}
                disabled={soon}
                onPress={x.onPress}
                style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, opacity: soon ? 0.55 : pressed ? 0.8 : 1 }]}
              >
                <View style={[styles.tileIcon, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name={x.icon} size={26} color={colors.primary} />
                </View>
                <Text variant="bodyStrong" numberOfLines={2}>
                  {name}
                </Text>
                <Text variant="caption" muted numberOfLines={1}>
                  {soon ? t('wallet.manage.soonHint') : (x.hint ?? ' ')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('wallet.getCard')}. ${t('wallet.getCardHint')}`}
          onPress={() => router.push('/wallet/cards')}
          style={styles.promo}
        >
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text variant="bodyStrong" color="#FFFFFF">
              {t('wallet.getCard')}
            </Text>
            <Text variant="small" color="#D1D1D6">
              {t('wallet.getCardHint')}
            </Text>
          </View>
          <View style={styles.promoArrow}>
            <Ionicons name="arrow-forward" size={20} color="#111111" />
          </View>
        </Pressable>

        {kyc.data && kyc.data.limits.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('wallet.manage.limits')}
            </Text>
            {kyc.data.limits.map((l) => (
              <View key={l.currency} accessible style={[styles.listRow, { backgroundColor: colors.surface }]}>
                <Text variant="bodyStrong">{l.currency}</Text>
                <Text variant="small" muted>
                  {t('wallet.kyc.limits', {
                    single: formatMoney(l.maxSingleTransferMinor, l.currency, locale),
                    daily: formatMoney(l.maxDailyOutgoingMinor, l.currency, locale),
                    max: formatMoney(l.maxBalanceMinor, l.currency, locale),
                  })}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '47.5%', flexGrow: 1, minHeight: 130, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.xs },
  tileIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  promo: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: '#111111', minHeight: 88 },
  promoArrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  listRow: { padding: spacing.md, borderRadius: radius.md, gap: 2 },
});
