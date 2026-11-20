import type { MoneyRequest } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { uuidv4 } from '../../../lib/uuid';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Chips } from '../../../seller/ui';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';
import { WALLET_NOTE_MAX } from '@caselind/contracts';
import { parseWalletAmount, WALLET_CURRENCIES } from '../../../wallet/amount';
import { walletKeys } from '../../../wallet/hooks';
import { cancelRequest, createRequest, declineRequest, fetchRequests, payRequest, walletFinanceKeys } from '../../../wallet/finance/api';
import { financeErrorMessage } from '../../../wallet/finance/errors';
import { daysLeft, requestActions } from '../../../wallet/finance/logic';
import { Card, FinanceHeader, PinPrompt } from '../../../wallet/finance/ui';

const HANDLE_RE = /^[a-zA-Z0-9_.]{3,30}$/;
type Side = 'received' | 'sent';

/** Demandes d'argent (mode test) : demander à un contact, puis voir, payer (avec PIN), refuser ou annuler. */
export default function WalletRequests() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ to?: string }>();
  const [side, setSide] = useState<Side>('received');
  const [paying, setPaying] = useState<MoneyRequest | null>(null);
  const [handle, setHandle] = useState(params.to ?? '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const clientId = useRef<{ sig: string; id: string } | null>(null);

  const list = useInfiniteQuery({
    queryKey: [...walletFinanceKeys.requests, side],
    queryFn: ({ pageParam }) => fetchRequests(side, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: walletFinanceKeys.requests });
    void qc.invalidateQueries({ queryKey: walletKeys.wallet });
    void qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
  };

  const parsed = parseWalletAmount(amount, currency);
  const minor = 'minor' in parsed ? parsed.minor : null;
  const clean = handle.trim().replace(/^@/, '').toLowerCase();

  const create = useMutation({
    mutationFn: () => {
      const sig = `${clean}|${minor}|${currency}|${note.trim()}`;
      if (clientId.current?.sig !== sig) clientId.current = { sig, id: uuidv4() };
      return createRequest({ clientId: clientId.current.id, payerHandle: clean, amountMinor: minor!, currency, note: note.trim() || undefined });
    },
    onSuccess: () => {
      clientId.current = null;
      setAmount('');
      setNote('');
      setFormError(null);
      setInfo(t('wf.req.created'));
      setSide('sent');
      refresh();
    },
    onError: (err) => {
      setInfo(null);
      setFormError(financeErrorMessage(err, t, locale, currency));
    },
  });
  const act = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'decline' | 'cancel' }) => (kind === 'decline' ? declineRequest(id) : cancelRequest(id)),
    onSuccess: refresh,
    onError: (err) => setFormError(financeErrorMessage(err, t, locale)),
  });

  function submit() {
    setInfo(null);
    if (!HANDLE_RE.test(clean)) return setFormError(t('wf.req.err.handle'));
    if (minor === null) return setFormError(t('wf.req.err.amount'));
    setFormError(null);
    create.mutate();
  }

  if (paying) {
    const r = paying;
    return (
      <>
        <Stack.Screen options={{ title: t('wf.req.title') }} />
        <PinPrompt
          hint={t('wf.req.payHint', { amount: formatMoney(r.amountMinor, r.currency, locale), name: r.counterparty.displayName })}
          onCancel={() => setPaying(null)}
          onSubmit={async (pin) => {
            await payRequest(r.id, pin);
            setPaying(null);
            setInfo(t('wf.req.paidDone'));
            refresh();
          }}
        />
      </>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('wf.req.title') }} />
      <View style={{ gap: spacing.lg }}>
        <FinanceHeader />
        <Card>
          <Text variant="bodyStrong" accessibilityRole="header">
            {t('wf.req.new')}
          </Text>
          <TextField label={t('wf.handle')} value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} />
          <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as 'USD' | 'CDF'} onChange={setCurrency} scroll={false} />
          <TextField label={t('wf.amount')} value={amount} onChangeText={setAmount} maxLength={12} keyboardType="decimal-pad" placeholder="0,00" error={amount && minor === null ? t('wf.req.err.amount') : null} />
          <TextField label={t('wf.note')} value={note} onChangeText={setNote} maxLength={WALLET_NOTE_MAX} />
          {formError ? (
            <Text color={colors.danger} accessibilityRole="alert">
              {formError}
            </Text>
          ) : null}
          {info ? <Text accessibilityLiveRegion="polite">{info}</Text> : null}
          <Button label={t('wf.req.send')} onPress={submit} loading={create.isPending} />
        </Card>

        <Chips
          options={[
            { value: 'received' as Side, label: t('wf.req.received') },
            { value: 'sent' as Side, label: t('wf.req.sent') },
          ]}
          value={side}
          onChange={setSide}
          scroll={false}
        />
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : items.length === 0 && !list.isLoading ? (
          <Text muted>{t('wf.req.empty')}</Text>
        ) : (
          items.map((r) => {
            const a = requestActions(r);
            return (
              <Card key={r.id}>
                <Text variant="bodyStrong">{formatMoney(r.amountMinor, r.currency, locale)}</Text>
                <Text>{t(r.direction === 'sent' ? 'wf.req.to' : 'wf.req.from', { name: `${r.counterparty.displayName} (@${r.counterparty.handle})` })}</Text>
                {r.note ? <Text muted>{r.note}</Text> : null}
                {r.billTitle ? (
                  <Text variant="caption" muted>
                    {t('wf.req.bill', { title: r.billTitle })}
                  </Text>
                ) : null}
                <Text variant="caption" muted>
                  {t(`wf.status.${r.status}` as const)}
                  {r.status === 'pending' ? ` · ${t('wf.req.expiresIn', { n: daysLeft(r.expiresAt) })}` : ''}
                </Text>
                <View style={styles.actions}>
                  {a.pay ? <Button label={t('wf.req.pay')} onPress={() => setPaying(r)} /> : null}
                  {a.decline ? (
                    <Button
                      variant="secondary"
                      label={t('wf.req.decline')}
                      onPress={() => alertConfirm(t('wf.req.confirmDecline'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('wf.req.decline'), style: 'destructive', onPress: () => act.mutate({ id: r.id, kind: 'decline' }) }])}
                    />
                  ) : null}
                  {a.cancel ? (
                    <Button
                      variant="secondary"
                      label={t('wf.req.cancel')}
                      onPress={() => alertConfirm(t('wf.req.confirmCancel'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('wf.req.cancel'), style: 'destructive', onPress: () => act.mutate({ id: r.id, kind: 'cancel' }) }])}
                    />
                  ) : null}
                </View>
              </Card>
            );
          })
        )}
        {list.hasNextPage ? <Button variant="ghost" label={t('common.retry')} onPress={() => list.fetchNextPage()} loading={list.isFetchingNextPage} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});


