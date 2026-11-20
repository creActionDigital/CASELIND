import type { SalaryLine } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { deleteSalary, fetchEmployees, fetchSalary, hrKeys, saveSalary } from '../../../../../business/hr/api';
import { businessErrorMessage } from '../../../../../business/hr/errors';
import { parseGross, periodOf } from '../../../../../business/hr/logic';
import { useI18n, type MessageKey } from '../../../../../i18n';
import { alertConfirm } from '../../../../../lib/confirm';
import { useMembership } from '../../../../../seller/api';
import { formatMinor, SELLER_CURRENCIES, type SellerCurrency } from '../../../../../seller/money';
import { canManagePayroll } from '../../../../../seller/permissions';
import { Card, Chips, Loading, SectionTitle } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

/** Registre de salaire (permission `payroll.manage`) : lignes saisies à la main, aucun calcul de paie. */
export default function SalaryRegister() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending } = useMembership(orgId);
  const allowed = canManagePayroll(role);
  const lines = useQuery({ queryKey: hrKeys.salary(orgId), queryFn: () => fetchSalary(orgId), enabled: !!orgId && allowed });
  const employees = useQuery({ queryKey: hrKeys.employees(orgId), queryFn: () => fetchEmployees(orgId), enabled: !!orgId && allowed });
  const [userId, setUserId] = useState<string | null>(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<SellerCurrency>('USD');
  const [note, setNote] = useState('');
  const [info, setInfo] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: hrKeys.salary(orgId) });
  const save = useMutation({
    mutationFn: () => {
      const p = periodOf(period);
      const gross = parseGross(amount, currency);
      if (!userId) throw new Error('employee');
      if (!p) throw new Error('period');
      if (gross === null) throw new Error('amount');
      return saveSalary(orgId, { userId, period: p, grossMinor: gross, currency, note: note.trim() || null });
    },
    onSuccess: () => { setInfo(null); setAmount(''); setNote(''); refresh(); },
    onError: (e) => setInfo(/^(employee|period|amount)$/.test((e as Error).message) ? t(`hr.err.${(e as Error).message}` as MessageKey) : businessErrorMessage(e, t, locale)),
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteSalary(orgId, id), onSuccess: refresh, onError: (e) => setInfo(businessErrorMessage(e, t, locale)) });
  const confirmDelete = (l: SalaryLine) =>
    alertConfirm(t('hr.salary.deleteConfirm'), `${l.displayName} ${l.period.slice(0, 7)}`, [
      { text: t('hr.cancel'), style: 'cancel' },
      { text: t('hr.delete'), style: 'destructive', onPress: () => remove.mutate(l.id) },
    ]);

  const title = <Stack.Screen options={{ title: t('hr.salary.title') }} />;
  if (isPending || lines.isPending || employees.isPending) return <>{title}<Loading /></>;
  if (!allowed) return <>{title}<Screen><Text muted>{t('hr.forbidden')}</Text></Screen></>;
  if (lines.isError) return <>{title}<ErrorState error={lines.error} onRetry={() => lines.refetch()} /></>;
  if (employees.isError) return <>{title}<ErrorState error={employees.error} onRetry={() => employees.refetch()} /></>;

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Text variant="small" muted>{t('hr.salary.notice')}</Text>
          <Chips options={employees.data.items.map((e) => ({ value: e.userId, label: e.displayName }))} value={userId} onChange={setUserId} />
          <TextField label={t('hr.salary.fieldPeriod')} value={period} onChangeText={setPeriod} maxLength={7} autoCapitalize="none" />
          <TextField label={t('hr.salary.fieldAmount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Chips options={SELLER_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} />
          <TextField label={t('hr.salary.fieldNote')} value={note} onChangeText={setNote} maxLength={200} />
          {info ? <Text color={colors.danger} accessibilityLiveRegion="polite">{info}</Text> : null}
          <Button label={t('hr.salary.save')} loading={save.isPending} onPress={() => { setInfo(null); save.mutate(); }} />

          <SectionTitle>{t('hr.salary.title')}</SectionTitle>
          {lines.data.items.length === 0 ? <Text muted>{t('hr.salary.empty')}</Text> : null}
          {lines.data.items.map((l) => (
            <Card key={l.id}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{l.displayName}</Text>
                  <Text variant="small" muted>{l.period.slice(0, 7)}{l.note ? ` · ${l.note}` : ''}</Text>
                </View>
                <Text variant="bodyStrong">{formatMinor(l.grossMinor, l.currency, locale)}</Text>
              </View>
              <Button variant="ghost" label={t('hr.delete')} onPress={() => confirmDelete(l)} />
            </Card>
          ))}
        </View>
      </Screen>
    </>
  );
}
