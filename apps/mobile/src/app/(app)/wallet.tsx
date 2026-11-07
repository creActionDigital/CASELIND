import { Ionicons } from '@expo/vector-icons';
import type { WalletTransaction } from '@caselind/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { formatMoney } from '../../shop/format';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text } from '../../ui';
import { Chips } from '../../seller/ui';
import { WALLET_CURRENCIES } from '../../wallet/amount';
import { flattenGroups, groupByDay } from '../../wallet/history';
import { useKyc, useTransactions, useWallet, useWalletEnabled, walletKeys } from '../../wallet/hooks';
import { setWalletPrefs, useWalletPrefs } from '../../wallet/prefs';
import { SandboxBanner, TxRow, TxSheet } from '../../wallet/ui';

/** Wallet sandbox : solde par devise, niveau KYC, actions, historique en défilement infini. */
export default function Wallet() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { tx: txParam } = useLocalSearchParams<{ tx?: string }>();
  const enabled = useWalletEnabled();
  const prefs = useWalletPrefs();
  const wallet = useWallet();
  const kyc = useKyc();
  const currency = prefs.currency;
  const history = useTransactions(currency);
  const [selected, setSelected] = useState<WalletTransaction | null>(null);

  const items = useMemo(() => history.data?.pages.flatMap((p) => p.items) ?? [], [history.data]);
  const rows = useMemo(() => flattenGroups(groupByDay(items)), [items]);

  // Notification `payment` : ouvre la fiche si la transaction est dans les pages chargées (id de transfert).
  useEffect(() => {
    if (!txParam) return;
    const found = items.find((x) => x.id === txParam);
    if (found) setSelected(found);
    else if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
  }, [txParam, items, history]);

  if (enabled === false) {
    return (
      <View style={styles.flex}>
        <EmptyState icon="wallet-outline" title={t('wallet.emptyTitle')} body={t('wallet.emptyBody')} />
      </View>
    );
  }

  const balance = wallet.data?.balances.find((b) => b.currency === currency)?.balanceMinor ?? 0;
  const limits = kyc.data?.limits.find((l) => l.currency === currency);
  const level = wallet.data?.kycTier ?? kyc.data?.level;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: walletKeys.wallet });
    void history.refetch();
  };

  const header = (
    <View style={styles.header}>
      <SandboxBanner />
      <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as 'USD' | 'CDF'} onChange={(c) => setWalletPrefs({ currency: c })} scroll={false} />
      <View style={[styles.card, { backgroundColor: colors.primary }]}>
        <Text variant="small" color={colors.onPrimary} style={{ opacity: 0.85 }}>
          {t('wallet.balance')} · {currency}
        </Text>
        <View style={styles.balanceRow}>
          <Text
            variant="display"
            color={colors.onPrimary}
            accessibilityLabel={prefs.hidden ? t('wallet.balanceHiddenLabel') : formatMoney(balance, currency, locale)}
            style={{ flex: 1 }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {wallet.isPending ? '…' : prefs.hidden ? '••••••' : formatMoney(balance, currency, locale)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={prefs.hidden ? t('wallet.show') : t('wallet.hide')}
            onPress={() => setWalletPrefs({ hidden: !prefs.hidden })}
            style={styles.eye}
          >
            <Ionicons name={prefs.hidden ? 'eye-outline' : 'eye-off-outline'} size={24} color={colors.onPrimary} />
          </Pressable>
        </View>
        {wallet.isError ? (
          <Text variant="small" color={colors.onPrimary}>
            {t('wallet.loadError')}
          </Text>
        ) : null}
        {level !== undefined ? (
          <View accessible style={styles.kyc}>
            <Text variant="small" color={colors.onPrimary} style={{ fontWeight: '600' }}>
              {t('wallet.kyc.level', { n: level })}
            </Text>
            {limits ? (
              <Text variant="caption" color={colors.onPrimary} style={{ opacity: 0.9 }}>
                {t('wallet.kyc.limits', {
                  single: formatMoney(limits.maxSingleTransferMinor, currency, locale),
                  daily: formatMoney(limits.maxDailyOutgoingMinor, currency, locale),
                  max: formatMoney(limits.maxBalanceMinor, currency, locale),
                })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Action icon="paper-plane-outline" label={t('wallet.action.send')} onPress={() => router.push('/wallet/send')} />
        <Action icon="add-circle-outline" label={t('wallet.action.topup')} onPress={() => router.push('/wallet/topup')} />
        <Action icon="qr-code-outline" label={t('wallet.action.receive')} onPress={() => router.push('/wallet/receive')} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('wallet.pin.manage')}
        onPress={() => router.push('/wallet/pin')}
        style={[styles.pinRow, { backgroundColor: colors.surface }]}
      >
        <Ionicons name="keypad-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text>{t('wallet.pin.manage')}</Text>
          {kyc.data ? (
            <Text variant="caption" muted>
              {kyc.data.hasPaymentPin ? t('wallet.pin.isSet') : t('wallet.pin.isNotSet')}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>
      <Text variant="heading" accessibilityRole="header" style={{ marginTop: spacing.sm }}>
        {t('wallet.history')}
      </Text>
    </View>
  );

  return (
    <View style={styles.flex}>
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.type === 'header' ? `h-${r.group.dayKey}` : r.tx.id)}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
        refreshing={history.isRefetching && !history.isFetchingNextPage}
        onRefresh={refresh}
        onEndReached={() => history.hasNextPage && !history.isFetchingNextPage && void history.fetchNextPage()}
        renderItem={({ item }) =>
          item.type === 'header' ? (
            <Text variant="small" muted accessibilityRole="header" style={{ marginTop: spacing.sm }}>
              {item.group.relative
                ? t(item.group.relative === 'today' ? 'wallet.today' : 'wallet.yesterday')
                : item.group.date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          ) : (
            <TxRow tx={item.tx} onPress={() => setSelected(item.tx)} />
          )
        }
        ListEmptyComponent={
          history.isPending ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={() => history.refetch()} />
          ) : (
            <EmptyState icon="swap-horizontal-outline" title={t('wallet.empty.title')} body={t('wallet.empty.body')} />
          )
        }
        ListFooterComponent={
          history.isFetchingNextPage ? (
            <ActivityIndicator color={colors.primary} />
          ) : history.isFetchNextPageError ? (
            <Button variant="ghost" label={t('common.retry')} onPress={() => history.fetchNextPage()} />
          ) : undefined
        }
      />
      <TxSheet tx={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: colors.surface, opacity: pressed ? 0.8 : 1 }]}
    >
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text variant="caption" style={{ textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: spacing.md },
  card: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eye: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  kyc: { gap: 2, marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, minHeight: 76, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.sm },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, minHeight: TOUCH + 8 },
});
