import type { Expense } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { bk, createExpense, deleteExpense, fetchExpenses } from '../../../../business/api';
import { businessErrorMessage } from '../../../../business/errors';
import { buildExpense, EXPENSE_CATEGORIES, emptyExpenseForm, PERIOD_PRESETS, periodFor, type ExpenseForm, type PeriodPreset } from '../../../../business/logic';
import { useI18n, type MessageKey } from '../../../../i18n';
import { alertConfirm } from '../../../../lib/confirm';
import { useMembership } from '../../../../seller/api';
import { formatMinor, SELLER_CURRENCIES } from '../../../../seller/money';
import { can } from '../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

/** « Dépenses » : lecture avec `finance.view`, saisie avec `finance.manage`. Enregistrements de gestion, aucun paiement. */
export default function SellerExpenses() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const canView = can(role, 'finance.view');
  const canWrite = can(role, 'finance.manage');
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [form, setForm] = useState<ExpenseForm>(emptyExpenseForm());
  const [info, setInfo] = useState<string | null>(null);
  const { from, to } = periodFor(preset, new Date());

  const list = useInfiniteQuery({
    queryKey: bk.expenses(orgId, from, to),
    queryFn: ({ pageParam }) => fetchExpenses(orgId, from, to, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: canView,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: bk.expensesAll(orgId) });
  const fail = (e: unknown) => setInfo(businessErrorMessage(e, t, locale));
  const add = useMutation({
    mutationFn: () => {
      const built = buildExpense(form);
      if ('error' in built) throw new Error(built.error);
      return createExpense(orgId, built.ok);
    },
    onSuccess: () => {
      setForm((f) => ({ ...emptyExpenseForm(), category: f.category, currency: f.currency }));
      setInfo(null);
      refresh();
    },
    onError: (e) => {
      const m = e instanceof Error ? e.message : '';
      if (m === 'amount' || m === 'date' || m === 'note') setInfo(t(`biz.expenses.err.${m}` as MessageKey));
      else fail(e);
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteExpense(orgId, id), onSuccess: refresh, onError: fail });

  const title = <Stack.Screen options={{ title: t('biz.expenses.title') }} />;
  if (isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!canView) return <>{title}<Screen><Text muted>{t('biz.expenses.forbidden')}</Text></Screen></>;

  const items: Expense[] = list.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (patch: Partial<ExpenseForm>) => setForm((f) => ({ ...f, ...patch }));
  const catLabel = (c: string) => t(`biz.cat.${c}` as MessageKey);
  const confirmDelete = (e: Expense) =>
    alertConfirm(t('biz.expenses.deleteTitle'), `${catLabel(e.category)} · ${formatMinor(e.amountMinor, e.currency, locale)}`, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('biz.expenses.delete'), style: 'destructive', onPress: () => remove.mutate(e.id) },
    ]);

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          {canWrite ? (
            <>
              <SectionTitle>{t('biz.expenses.new')}</SectionTitle>
              <Chips options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: catLabel(c) }))} value={form.category} onChange={(category) => set({ category })} />
              <Chips options={SELLER_CURRENCIES.map((c) => ({ value: c, label: c }))} value={form.currency} onChange={(currency) => set({ currency })} scroll={false} />
              <TextField label={t('biz.expenses.amount', { currency: form.currency })} value={form.amount} onChangeText={(v) => set({ amount: v })} keyboardType="decimal-pad" />
              <TextField label={t('biz.expenses.date')} value={form.spentOn} onChangeText={(v) => set({ spentOn: v })} maxLength={10} autoCapitalize="none" />
              <TextField label={t('biz.expenses.note')} value={form.note} onChangeText={(v) => set({ note: v })} maxLength={200} />
              {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
              <Button label={t('biz.expenses.add')} loading={add.isPending} onPress={() => { setInfo(null); add.mutate(); }} />
            </>
          ) : (
            <Text muted>{t('biz.expenses.readOnly')}</Text>
          )}

          <SectionTitle>{t('biz.expenses.title')}</SectionTitle>
          <Chips options={PERIOD_PRESETS.map((p) => ({ value: p, label: t(`biz.period.${p}` as MessageKey) }))} value={preset} onChange={setPreset} />
          {!canWrite && info ? <Text color={colors.danger}>{info}</Text> : null}
          {list.isPending ? <Loading /> : null}
          {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
          {list.isSuccess && items.length === 0 ? <Text muted>{t('biz.expenses.empty')}</Text> : null}
          {items.map((e) => (
            <Card key={e.id}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Badge label={catLabel(e.category)} tone="neutral" />
                <Text variant="bodyStrong" style={{ flex: 1, textAlign: 'right' }}>{formatMinor(e.amountMinor, e.currency, locale)}</Text>
              </View>
              <Text variant="small" muted>{e.supplierName ? `${e.spentOn} · ${e.supplierName}` : e.spentOn}</Text>
              {e.note ? <Text numberOfLines={3}>{e.note}</Text> : null}
              {canWrite ? <Button variant="secondary" label={t('biz.expenses.delete')} loading={remove.isPending && remove.variables === e.id} onPress={() => confirmDelete(e)} /> : null}
            </Card>
          ))}
          {list.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} /> : null}
        </View>
      </Screen>
    </>
  );
}
