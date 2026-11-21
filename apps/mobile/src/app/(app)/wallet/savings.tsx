import { SAVINGS_TITLE_MAX, type SavingsGoal } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
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
import { walletKeys } from '../../../wallet/hooks';
import { archiveSavings, createSavings, fetchSavings, moveSavings, walletFinanceKeys } from '../../../wallet/finance/api';
import { financeErrorMessage } from '../../../wallet/finance/errors';
import { parseDateOnly } from '../../../wallet/finance/logic';
import { Card, FinanceHeader, PinPrompt } from '../../../wallet/finance/ui';

interface Move {
  goal: SavingsGoal;
  kind: 'deposit' | 'withdraw';
  amountMinor: number;
}

/** Tirelires (mode test) : objectifs d'épargne ; versements et retraits entre le compte courant et la tirelire, avec PIN. */
export default function WalletSavings() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [deadline, setDeadline] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const moveId = useRef<{ sig: string; id: string } | null>(null);

  const list = useQuery({ queryKey: walletFinanceKeys.savings, queryFn: fetchSavings });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: walletFinanceKeys.savings });
    void qc.invalidateQueries({ queryKey: walletKeys.wallet });
    void qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
  };

  const parsedTarget = parseWalletAmount(target, currency);
  const targetMinor = 'minor' in parsedTarget ? parsedTarget.minor : null;
  const deadlineOk = deadline.trim() ? parseDateOnly(deadline) : undefined;

  const create = useMutation({
    mutationFn: () => createSavings({ title: title.trim(), targetMinor: targetMinor!, currency, deadline: deadlineOk ?? undefined }),
    onSuccess: () => {
      setTitle('');
      setTarget('');
      setDeadline('');
      setError(null);
      refresh();
    },
    onError: (err) => setError(financeErrorMessage(err, t, locale, currency)),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveSavings(id),
    onSuccess: refresh,
    onError: (err) => setError(financeErrorMessage(err, t, locale)),
  });

  function submit() {
    if (!title.trim()) return setError(t('wf.sav.titleField'));
    if (targetMinor === null) return setError(t('wf.req.err.amount'));
    if (deadlineOk === null) return setError(t('wf.sav.err.deadline'));
    setError(null);
    create.mutate();
  }

  function ask(goal: SavingsGoal, kind: 'deposit' | 'withdraw') {
    const p = parseWalletAmount(amounts[goal.id] ?? '', goal.currency);
    if (!('minor' in p)) return setError(t('wf.req.err.amount'));
    if (kind === 'withdraw' && p.minor > goal.savedMinor) return setError(t('wf.sav.err.over', { amount: formatMoney(goal.savedMinor, goal.currency, locale) }));
    setError(null);
    setMove({ goal, kind, amountMinor: p.minor });
  }

  if (move) {
    const m = move;
    return (
      <>
        <Stack.Screen options={{ title: t('wf.sav.title') }} />
        <PinPrompt
          hint={`${t(m.kind === 'deposit' ? 'wf.sav.deposit' : 'wf.sav.withdraw')} ${formatMoney(m.amountMinor, m.goal.currency, locale)} · ${m.goal.title}`}
          onCancel={() => setMove(null)}
          onSubmit={async (pin) => {
            const sig = `${m.goal.id}|${m.kind}|${m.amountMinor}`;
            if (moveId.current?.sig !== sig) moveId.current = { sig, id: uuidv4() };
            await moveSavings(m.goal.id, m.kind, { clientId: moveId.current.id, amountMinor: m.amountMinor, pin });
            moveId.current = null;
            setAmounts((a) => ({ ...a, [m.goal.id]: '' }));
            setMove(null);
            refresh();
          }}
        />
      </>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('wf.sav.title') }} />
      <View style={{ gap: spacing.lg }}>
        <FinanceHeader />
        <Card>
          <Text variant="bodyStrong" accessibilityRole="header">
            {t('wf.sav.new')}
          </Text>
          <TextField label={t('wf.sav.titleField')} value={title} onChangeText={setTitle} maxLength={SAVINGS_TITLE_MAX} />
          <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency as 'USD' | 'CDF'} onChange={setCurrency} scroll={false} />
          <TextField label={t('wf.sav.target')} value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="0,00" error={target && targetMinor === null ? t('wf.req.err.amount') : null} />
          <TextField label={t('wf.sav.deadline')} value={deadline} onChangeText={setDeadline} maxLength={10} placeholder="2027-06-30" autoCapitalize="none" />
          {error ? (
            <Text color={colors.danger} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button label={t('wf.sav.create')} onPress={submit} loading={create.isPending} />
        </Card>

        {list.isPending ? (
          <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data?.items.filter((g) => !g.archived).length === 0 ? (
          <Text muted>{t('wf.sav.empty')}</Text>
        ) : (
          list.data?.items
            .filter((g) => !g.archived)
            .map((g) => (
              <Card key={g.id}>
                <Text variant="bodyStrong">{g.title}</Text>
                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: g.progressPercent }}
                  accessibilityLabel={t('wf.sav.progress', { saved: formatMoney(g.savedMinor, g.currency, locale), target: formatMoney(g.targetMinor, g.currency, locale) })}
                  style={[styles.bar, { backgroundColor: colors.surfaceAlt }]}
                >
                  <View style={{ width: `${g.progressPercent}%`, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
                </View>
                <Text variant="small" muted>
                  {t('wf.sav.progress', { saved: formatMoney(g.savedMinor, g.currency, locale), target: formatMoney(g.targetMinor, g.currency, locale) })} · {g.progressPercent}%
                  {g.savedMinor >= g.targetMinor ? ` · ${t('wf.sav.reached')}` : ''}
                  {g.deadline ? ` · ${t('wf.sav.until', { date: g.deadline })}` : ''}
                </Text>
                <TextField label={t('wf.amount')} value={amounts[g.id] ?? ''} onChangeText={(v) => setAmounts((a) => ({ ...a, [g.id]: v }))} keyboardType="decimal-pad" placeholder="0,00" />
                <View style={styles.actions}>
                  <Button label={t('wf.sav.deposit')} onPress={() => ask(g, 'deposit')} />
                  <Button variant="secondary" label={t('wf.sav.withdraw')} onPress={() => ask(g, 'withdraw')} />
                  <Button
                    variant="ghost"
                    label={t('wf.sav.archive')}
                    onPress={() => alertConfirm(t('wf.sav.confirmArchive'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('wf.sav.archive'), onPress: () => archive.mutate(g.id) }])}
                  />
                </View>
              </Card>
            ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
