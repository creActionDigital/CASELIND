import { Ionicons } from '@expo/vector-icons';
import type { WalletTransaction } from '@caselind/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { formatMoney } from '../../shop/format';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text } from '../../ui';
import { AccountCard, AddCardTile } from '../../wallet/AccountCard';
import { WALLET_CURRENCIES } from '../../wallet/amount';
import { flattenGroups, groupByDay } from '../../wallet/history';
import { useKyc, useTransactions, useWallet, useWalletEnabled, walletKeys } from '../../wallet/hooks';
import { setWalletPrefs, useWalletPrefs } from '../../wallet/prefs';
import { SandboxBanner, TxRow, TxSheet } from '../../wallet/ui';

/** Wallet sandbox : solde, comptes présentés comme des cartes, actions, historique en défilement infini. */
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

  // Chaque compte du wallet est présenté comme une carte (aucune carte bancaire réelle n'existe).
  const accounts: { currency: string; balanceMinor: number }[] = WALLET_CURRENCIES.map((c) => ({
    currency: c,
    balanceMinor: wallet.data?.balances.find((x) => x.currency === c)?.balanceMinor ?? 0,
  }));
  for (const b of wallet.data?.balances ?? []) {
    if (!accounts.some((x) => x.currency === b.currency)) accounts.push({ currency: b.currency, balanceMinor: b.balanceMinor });
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('wallet.addCard')}. ${t('wallet.getCardHint')}`}
          onPress={() => router.push('/wallet/cards')}
          style={[styles.cardPill, { backgroundColor: colors.text }]}
        >
          <Ionicons name="add-circle" size={22} color={colors.background} />
          <Text variant="bodyStrong" color={colors.background}>
            {t('wallet.addCard')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notifications.title')}
          onPress={() => router.push('/notifications')}
          style={[styles.bell, { backgroundColor: colors.surface }]}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
        </Pressable>
      </View>
      <SandboxBanner />
      <View style={[styles.totalCard, { backgroundColor: colors.surface }]}>
        <View style={styles.totalTop}>
          <Text variant="small" muted>
            {t('wallet.totalBalance')} · {currency}
          </Text>
          <View style={styles.balanceRow}>
            <Text
              variant="display"
              accessibilityLabel={prefs.hidden ? t('wallet.balanceHiddenLabel') : formatMoney(balance, currency, locale)}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ flexShrink: 1 }}
            >
              {wallet.isPending ? '…' : prefs.hidden ? '••••••' : formatMoney(balance, currency, locale)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={prefs.hidden ? t('wallet.show') : t('wallet.hide')}
              onPress={() => setWalletPrefs({ hidden: !prefs.hidden })}
              style={styles.eye}
            >
              <Ionicons name={prefs.hidden ? 'eye-outline' : 'eye-off-outline'} size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          {wallet.isError ? (
            <Text variant="small" color={colors.danger}>
              {t('wallet.loadError')}
            </Text>
          ) : null}
          {level !== undefined ? (
            <Text variant="caption" muted style={{ textAlign: 'center' }}>
              {t('wallet.kyc.level', { n: level })}
              {limits
                ? ` · ${t('wallet.kyc.limits', {
                    single: formatMoney(limits.maxSingleTransferMinor, currency, locale),
                    daily: formatMoney(limits.maxDailyOutgoingMinor, currency, locale),
                    max: formatMoney(limits.maxBalanceMinor, currency, locale),
                  })}`
                : ''}
            </Text>
          ) : null}
        </View>
        <View style={[styles.actions, { borderTopColor: colors.border }]}>
          <Action icon="arrow-up" label={t('wallet.action.send')} onPress={() => router.push('/wallet/send')} />
          <Action icon="add" label={t('wallet.action.topup')} onPress={() => router.push('/wallet/topup')} />
          <Action icon="arrow-down" label={t('wallet.action.receive')} onPress={() => router.push('/wallet/receive')} />
          <Action icon="scan-outline" label={t('wallet.action.scan')} onPress={() => router.push('/scan')} />
        </View>
      </View>

      <View style={styles.sectionRow}>
        <Text variant="bodyStrong" accessibilityRole="header">
          {t('wallet.yourCards')}{' '}
          <Text variant="small" muted>
            ({accounts.length})
          </Text>
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('wallet.manage.title')} onPress={() => router.push('/wallet/manage')} hitSlop={8}>
          <Text variant="small" muted>
            {t('wallet.manageLink')}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards} style={styles.cardsBleed}>
        <AddCardTile label={t('wallet.cardAddTile')} onPress={() => router.push('/wallet/cards')} />
        {accounts.map((a) => (
          <AccountCard
            key={a.currency}
            currency={a.currency}
            balanceMinor={a.balanceMinor}
            hidden={prefs.hidden}
            selected={a.currency === currency}
            onPress={() => setWalletPrefs({ currency: a.currency as 'USD' | 'CDF' })}
          />
        ))}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('wallet.getCard')}. ${t('wallet.getCardHint')}`}
        onPress={() => router.push('/wallet/cards')}
        style={styles.promo}
      >
        <View style={styles.promoBlobA} />
        <View style={styles.promoBlobB} />
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

      <Text variant="bodyStrong" accessibilityRole="header" style={{ marginTop: spacing.sm }}>
        {t('wallet.recent')}
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
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.actionIcon, { backgroundColor: colors.background }]}>
        <Ionicons name={icon} size={22} color={colors.text} />
      </View>
      <Text variant="caption" style={{ textAlign: 'center' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: spacing.md },
  topRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  cardPill: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill },
  bell: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  totalCard: { borderRadius: radius.xl, overflow: 'hidden' },
  totalTop: { alignItems: 'center', padding: spacing.lg, gap: spacing.xs },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eye: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  action: { flex: 1, alignItems: 'center', gap: spacing.xs, minHeight: TOUCH },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  cardsBleed: { marginHorizontal: -spacing.lg },
  cards: { gap: spacing.md, paddingHorizontal: spacing.lg },
  promo: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: '#111111', overflow: 'hidden', minHeight: 96 },
  promoBlobA: { position: 'absolute', right: 20, top: -30, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.07)' },
  promoBlobB: { position: 'absolute', right: -30, bottom: -40, width: 100, height: 100, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.05)' },
  promoArrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
});
