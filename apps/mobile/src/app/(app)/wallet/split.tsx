import { PeopleField } from '../../../components/PersonField';
import type { Person } from '../../../people/logic';
import { SPLIT_PARTICIPANTS_MAX, SPLIT_TITLE_MAX } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { mergeDeepItem } from '../../../lib/deep-item';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { uuidv4 } from '../../../lib/uuid';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Chips } from '../../../seller/ui';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';
import { parseWalletAmount, WALLET_CURRENCIES } from '../../../wallet/amount';
import { cancelSplitBill, createSplitBill, fetchSplitBill, fetchSplitBills, walletFinanceKeys } from '../../../wallet/finance/api';
import { financeErrorMessage } from '../../../wallet/finance/errors';
import { cleanHandle, customSplitPreview, equalSplitPreview } from '../../../wallet/finance/logic';
import { Card, FinanceHeader } from '../../../wallet/finance/ui';

type Mode = 'equal' | 'custom';

/** Paiement partagé (mode test) : parts égales ou libres entre vos contacts ; chaque part devient une demande d'argent. */
export default function WalletSplit() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [total, setTotal] = useState('');
  const [mode, setMode] = useState<Mode>('equal');
  const [people, setPeople] = useState<Person[]>([]);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef<{ sig: string; id: string } | null>(null);

  const handles = [...new Set(people.map((x) => cleanHandle(x.handle)).filter(Boolean))];
  const parsedTotal = parseWalletAmount(total, currency);
  const totalMinor = 'minor' in parsedTotal ? parsedTotal.minor : null;
  const customMinor = handles.map((h) => {
    const p = parseWalletAmount(custom[h] ?? '', currency);
    return 'minor' in p ? p.minor : 0;
  });
  const preview =
    totalMinor === null || handles.length === 0 || handles.length > SPLIT_PARTICIPANTS_MAX
      ? null
      : mode === 'equal'
        ? equalSplitPreview(totalMinor, handles.length)
        : customSplitPreview(totalMinor, customMinor);

  const bills = useQuery({ queryKey: walletFinanceKeys.split, queryFn: () => fetchSplitBills() });
  const { id: deepId } = useLocalSearchParams<{ id?: string }>();
  const one = useQuery({ queryKey: [...walletFinanceKeys.split, deepId], queryFn: () => fetchSplitBill(deepId!), enabled: !!deepId });
  const billItems = bills.data ? mergeDeepItem(bills.data.items, one.data) : [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: walletFinanceKeys.split });
    void qc.invalidateQueries({ queryKey: walletFinanceKeys.requests });
  };

  const create = useMutation({
    mutationFn: () => {
      const sig = JSON.stringify([title.trim(), currency, totalMinor, mode, handles, customMinor]);
      if (clientId.current?.sig !== sig) clientId.current = { sig, id: uuidv4() };
      return createSplitBill({
        clientId: clientId.current.id,
        title: title.trim(),
        currency,
        totalMinor: totalMinor!,
        split: mode,
        participants: handles.map((handle, i) => (mode === 'custom' ? { handle, amountMinor: customMinor[i]! } : { handle })),
      });
    },
    onSuccess: () => {
      clientId.current = null;
      setTitle('');
      setTotal('');
      setPeople([]);
      setCustom({});
      setError(null);
      refresh();
    },
    onError: (err) => setError(financeErrorMessage(err, t, locale, currency)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelSplitBill(id),
    onSuccess: refresh,
    onError: (err) => setError(financeErrorMessage(err, t, locale)),
  });

  function submit() {
    if (!title.trim()) return setError(t('wf.split.titleField'));
    if (totalMinor === null) return setError(t('wf.req.err.amount'));
    if (handles.length < 1 || handles.length > SPLIT_PARTICIPANTS_MAX) return setError(t('wf.split.err.participants'));
    if (preview === null) return setError(t('wf.split.err.small'));
    if ('issue' in preview) return setError(t(preview.issue === 'over' ? 'wf.split.err.over' : 'wf.split.err.amounts'));
    setError(null);
    create.mutate();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('wf.split.title') }} />
      <View style={{ gap: spacing.lg }}>
        <FinanceHeader />
        <Card>
          <Text variant="bodyStrong" accessibilityRole="header">
            {t('wf.split.new')}
          </Text>
          <TextField label={t('wf.split.titleField')} value={title} onChangeText={setTitle} maxLength={SPLIT_TITLE_MAX} />
          <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as 'USD' | 'CDF'} onChange={setCurrency} scroll={false} />
          <TextField label={t('wf.split.total')} value={total} onChangeText={setTotal} keyboardType="decimal-pad" placeholder="0,00" error={total && totalMinor === null ? t('wf.req.err.amount') : null} />
          <Chips
            options={[
              { value: 'equal' as Mode, label: t('wf.split.mode.equal') },
              { value: 'custom' as Mode, label: t('wf.split.mode.custom') },
            ]}
            value={mode}
            onChange={setMode}
            scroll={false}
          />
          <PeopleField label={t('wf.split.participants')} value={people} onChange={setPeople} max={SPLIT_PARTICIPANTS_MAX} />
          {mode === 'custom'
            ? handles.map((h) => (
                <TextField key={h} label={t('wf.split.shareOf', { handle: h })} value={custom[h] ?? ''} onChangeText={(v) => setCustom((c) => ({ ...c, [h]: v }))} keyboardType="decimal-pad" placeholder="0,00" />
              ))
            : null}
          {preview && !('issue' in preview) ? (
            <Text variant="small" muted accessibilityLiveRegion="polite">
              {t('wf.split.preview', {
                amounts: preview.shares.map((s) => formatMoney(s, currency, locale)).join(' · '),
                self: formatMoney(preview.selfMinor, currency, locale),
              })}
            </Text>
          ) : null}
          {error ? (
            <Text color={colors.danger} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button label={t('wf.split.create')} onPress={submit} loading={create.isPending} />
        </Card>

        {bills.isPending ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
        ) : bills.isError ? (
          <ErrorState error={bills.error} onRetry={() => bills.refetch()} />
        ) : billItems.length === 0 ? (
          <Text muted>{t('wf.split.empty')}</Text>
        ) : (
          billItems.map((b) => (
            <Card key={b.id}>
              <Text variant="bodyStrong">{b.title}</Text>
              <Text>{formatMoney(b.totalMinor, b.currency, locale)}</Text>
              <Text variant="caption" muted>
                {t(`wf.status.${b.status}` as const)} · {t('wf.split.progress', { paid: formatMoney(b.paidMinor, b.currency, locale), total: formatMoney(b.totalMinor - b.selfMinor, b.currency, locale) })}
              </Text>
              <Text variant="caption" muted>
                {t('wf.split.self', { amount: formatMoney(b.selfMinor, b.currency, locale) })}
              </Text>
              {b.shares.map((s) => (
                <Text key={s.user.userId} variant="small">
                  @{s.user.handle} · {formatMoney(s.amountMinor, b.currency, locale)} · {t(`wf.status.${s.status}` as const)}
                </Text>
              ))}
              {b.status === 'open' ? (
                <View style={styles.actions}>
                  <Button
                    variant="secondary"
                    label={t('wf.split.cancel')}
                    onPress={() => alertConfirm(t('wf.split.confirmCancel'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('wf.split.cancel'), style: 'destructive', onPress: () => cancel.mutate(b.id) }])}
                  />
                </View>
              ) : null}
            </Card>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
