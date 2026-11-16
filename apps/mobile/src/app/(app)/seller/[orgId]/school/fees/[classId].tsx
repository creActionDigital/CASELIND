import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../../../../i18n';
import { createFee, feeKeys, fetchFeeStatuses, fetchFees, markFee } from '../../../../../../school/fees-api';
import { parseDecimalToMinor, formatMinor } from '../../../../../../seller/money';
import { Card, Chips, Loading, SectionTitle, sellerErrorMessage } from '../../../../../../seller/ui';
import { spacing } from '../../../../../../theme/tokens';
import { useTheme } from '../../../../../../theme/use-theme';
import { Badge, Button, ErrorState, Text, TextField } from '../../../../../../ui';

/** Frais d'une classe (personnel de l'école) : énoncer un frais, voir combien d'élèves ont payé, marquer un élève. Un relevé, aucun paiement. */
export default function ClassFees() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId, classId } = useLocalSearchParams<{ orgId: string; classId: string }>();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'CDF'>('USD');
  const [dueOn, setDueOn] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fees = useQuery({ queryKey: feeKeys.list(orgId, classId), queryFn: () => fetchFees(orgId, classId) });
  const create = useMutation({
    mutationFn: () => {
      const minor = parseDecimalToMinor(amount, currency);
      if (minor === null || !title.trim()) throw new Error('invalid');
      return createFee(orgId, classId, { title: title.trim(), amountMinor: minor, currency, ...(dueOn.trim() ? { dueOn: dueOn.trim() } : {}) });
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      setTitle('');
      setAmount('');
      setDueOn('');
      void qc.invalidateQueries({ queryKey: feeKeys.list(orgId, classId) });
    },
    onError: (e) => setError(e instanceof Error && e.message === 'invalid' ? t('fees.err.invalid') : sellerErrorMessage(e, t, locale)),
  });
  return (
    <>
      <Stack.Screen options={{ title: t('fees.staff.manage') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        <SectionTitle>{t('fees.new')}</SectionTitle>
        <TextField label={t('fees.field.title')} value={title} onChangeText={setTitle} maxLength={80} />
        <Chips scroll={false} options={(['USD', 'CDF'] as const).map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />
        <TextField label={t('fees.field.amount', { currency })} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <TextField label={t('fees.field.due')} value={dueOn} onChangeText={setDueOn} maxLength={10} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('fees.create')} loading={create.isPending} disabled={!title.trim() || !amount.trim()} onPress={() => create.mutate()} />
        {fees.isPending ? <Loading /> : null}
        {fees.isError ? <ErrorState error={fees.error} onRetry={() => fees.refetch()} /> : null}
        {fees.data?.items.length === 0 ? <Text muted>{t('fees.empty')}</Text> : null}
        {fees.data?.items.map((f) => (
          <Card key={f.id}>
            <Text variant="bodyStrong">{f.title}</Text>
            <Text>{formatMinor(f.amountMinor, f.currency, locale)}</Text>
            <Text variant="small" muted>
              {t('fees.paidOf', { paid: f.paidCount, total: f.studentCount })}
              {f.dueOn ? ` · ${t('fees.due', { date: f.dueOn })}` : ''}
            </Text>
            <Button variant="ghost" label={openId === f.id ? t('fees.hide') : t('fees.show')} onPress={() => setOpenId(openId === f.id ? null : f.id)} />
            {openId === f.id ? <Statuses orgId={orgId} classId={classId} feeId={f.id} /> : null}
          </Card>
        ))}
        <Text variant="small" muted>
          {t('fees.note')}
        </Text>
      </ScrollView>
    </>
  );
}

function Statuses({ orgId, classId, feeId }: { orgId: string; classId: string; feeId: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: feeKeys.statuses(orgId, classId, feeId), queryFn: () => fetchFeeStatuses(orgId, classId, feeId) });
  const mark = useMutation({
    mutationFn: (v: { handle: string; paid: boolean }) => markFee(orgId, classId, feeId, v.handle, v.paid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: feeKeys.statuses(orgId, classId, feeId) });
      void qc.invalidateQueries({ queryKey: feeKeys.list(orgId, classId) });
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  void locale;
  return (
    <View style={{ gap: spacing.xs }}>
      {q.data.items.map((s) => (
        <View key={s.handle} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1}>{s.displayName}</Text>
            <Text variant="small" muted>
              @{s.handle}
            </Text>
          </View>
          <Badge tone="neutral" label={s.paid ? t('fees.status.paid') : t('fees.status.unpaid')} />
          <Button variant="ghost" label={s.paid ? t('fees.markUnpaid') : t('fees.markPaid')} disabled={mark.isPending} onPress={() => mark.mutate({ handle: s.handle, paid: !s.paid })} />
        </View>
      ))}
    </View>
  );
}
