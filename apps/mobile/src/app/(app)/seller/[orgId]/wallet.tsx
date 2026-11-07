import type { WalletTransaction } from '@caselind/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { Chips } from '../../../../seller/ui';
import { formatMoney } from '../../../../shop/format';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text } from '../../../../ui';
import { WALLET_CURRENCIES } from '../../../../wallet/amount';
import { flattenGroups, groupByDay } from '../../../../wallet/history';
import { useOrgTransactions, useOrgWallet } from '../../../../wallet/hooks';
import { SandboxBanner, TxRow, TxSheet } from '../../../../wallet/ui';

/** Wallet d'une organisation (sandbox), en lecture seule : solde et transactions (permission `finance.view`). */
export default function OrgWallet() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const [currency, setCurrency] = useState<string>('USD');
  const [selected, setSelected] = useState<WalletTransaction | null>(null);
  const wallet = useOrgWallet(orgId);
  const history = useOrgTransactions(orgId, currency);
  const items = useMemo(() => history.data?.pages.flatMap((p) => p.items) ?? [], [history.data]);
  const rows = useMemo(() => flattenGroups(groupByDay(items)), [items]);
  const balance = wallet.data?.balances.find((b) => b.currency === currency)?.balanceMinor ?? 0;

  const header = (
    <View style={{ gap: spacing.md }}>
      <SandboxBanner />
      <Text variant="small" muted>
        {t('wallet.org.readOnly')}
      </Text>
      <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as 'USD' | 'CDF'} onChange={setCurrency} scroll={false} />
      <View style={[styles.card, { backgroundColor: colors.primary }]}>
        <Text variant="small" color={colors.onPrimary} style={{ opacity: 0.85 }}>
          {t('wallet.balance')} · {currency}
        </Text>
        <Text variant="display" color={colors.onPrimary} numberOfLines={1} adjustsFontSizeToFit>
          {wallet.isPending ? '…' : formatMoney(balance, currency, locale)}
        </Text>
      </View>
      {wallet.isError ? <ErrorState error={wallet.error} onRetry={() => wallet.refetch()} /> : null}
      <Text variant="heading" accessibilityRole="header">
        {t('wallet.history')}
      </Text>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: t('wallet.org.title') }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.type === 'header' ? `h-${r.group.dayKey}` : r.tx.id)}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
        refreshing={history.isRefetching && !history.isFetchingNextPage}
        onRefresh={() => {
          void wallet.refetch();
          void history.refetch();
        }}
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
            <EmptyState icon="swap-horizontal-outline" title={t('wallet.empty.title')} />
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
    </>
  );
}

const styles = StyleSheet.create({ card: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs } });
