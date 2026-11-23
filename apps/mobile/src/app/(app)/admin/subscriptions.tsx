import type { AdminSubscription, SubscriptionPlan } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { cck, renewDueSubscriptions } from '../../../admin/console-api';
import { AdminList, Denied, adminErrorMessage, adminStyles, useCursorList, useHasRole, when } from '../../../admin/kit';
import { useI18n, type MessageKey } from '../../../i18n';
import { alertConfirm } from '../../../lib/confirm';
import { adminCancelSubscription, fetchAdminPlans, fetchAdminSubscriptions, putPlan } from '../../../premium/api';
import { planNameKey } from '../../../premium/logic';
import { Card, Chips } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, Text, TextField } from '../../../ui';
import { parseWalletAmount } from '../../../wallet/amount';

const major = (minor: number, currency: string) => (minor / (currency === 'CDF' ? 100 : 100)).toFixed(2);

function PlanEditor({ plan }: { plan: SubscriptionPlan }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [usd, setUsd] = useState(major(plan.priceUsdMinor, 'USD'));
  const [cdf, setCdf] = useState(major(plan.priceCdfMinor, 'CDF'));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const u = parseWalletAmount(usd, 'USD', 100_000_000);
      const c = parseWalletAmount(cdf, 'CDF', 100_000_000_000);
      if (!('minor' in u) || !('minor' in c) || u.minor < 1 || c.minor < 1) throw new Error('invalid');
      return putPlan(plan.code, { priceUsdMinor: u.minor, priceCdfMinor: c.minor, active: plan.active });
    },
    onSuccess: () => {
      setMsg({ ok: true, text: t('mon.adm.subs.saved') });
      void qc.invalidateQueries({ queryKey: ['admin-plans'] });
      void qc.invalidateQueries({ queryKey: ['premium-plans'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error && e.message === 'invalid' ? t('mon.adm.subs.invalid') : adminErrorMessage(e, t, locale) }),
  });
  return (
    <Card style={adminStyles.card}>
      <Text style={{ fontWeight: '700' }}>{t(planNameKey(plan.code))}</Text>
      <TextField label={t('mon.adm.subs.usd')} value={usd} onChangeText={setUsd} keyboardType="decimal-pad" />
      <TextField label={t('mon.adm.subs.cdf')} value={cdf} onChangeText={setCdf} keyboardType="decimal-pad" />
      {msg ? <Text variant="small" color={msg.ok ? colors.success : colors.danger} accessibilityLiveRegion="polite">{msg.text}</Text> : null}
      <Button variant="secondary" label={t('mon.adm.subs.save')} loading={save.isPending} onPress={() => save.mutate()} />
    </Card>
  );
}

function SubCard({ s }: { s: AdminSubscription }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => adminCancelSubscription(s.id),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: cck.all });
    },
    onError: (e) => setError(adminErrorMessage(e, t, locale)),
  });
  return (
    <Card style={adminStyles.card}>
      <View style={adminStyles.badges}>
        <Badge tone={s.status === 'active' ? 'primary' : 'neutral'} label={t(`mon.status.${s.status}` as MessageKey)} />
        <Text variant="small">{formatMoney(s.priceMinor, s.currency, locale)}</Text>
      </View>
      <Text style={{ fontWeight: '700' }}>{t(planNameKey(s.planCode))}</Text>
      <Text variant="small" muted>
        {s.orgId ? t('mon.adm.subs.org') : t('mon.adm.subs.holder', { id: s.userId.slice(0, 8) })} · {t('mon.validUntil', { date: when(s.currentPeriodEnd, locale) })}
      </Text>
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      {s.status === 'active' ? (
        <Button
          variant="danger"
          label={t('mon.adm.subs.cancel')}
          loading={cancel.isPending}
          onPress={() => alertConfirm(t('mon.adm.subs.cancel'), t('mon.adm.subs.cancel.confirm'), [{ text: t('adm.cancel'), style: 'cancel' }, { text: t('mon.adm.subs.cancel'), style: 'destructive', onPress: () => cancel.mutate() }])}
        />
      ) : null}
    </Card>
  );
}

/** Abonnements : prix des plans (réglables), liste et annulation immédiate. */
export default function AdminSubscriptions() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [renewed, setRenewed] = useState<{ ok: boolean; text: string } | null>(null);
  const renew = useMutation({
    mutationFn: renewDueSubscriptions,
    onSuccess: (r) => {
      setRenewed({ ok: true, text: t('adm.subs.renew.done', { n: r.renewed }) });
      void qc.invalidateQueries({ queryKey: cck.all });
    },
    onError: (e) => setRenewed({ ok: false, text: adminErrorMessage(e, t, locale) }),
  });
  const allowed = useHasRole(['admin']);
  const [status, setStatus] = useState<'active' | 'expired'>('active');
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: fetchAdminPlans, enabled: allowed });
  const query = useCursorList(['subscriptions', status], (c) => fetchAdminSubscriptions(status, c), allowed);
  if (!allowed) return <Denied />;
  return (
    <AdminList<AdminSubscription>
      title={t('mon.adm.subs.title')}
      query={query}
      keyExtractor={(s) => s.id}
      emptyTitle={t('adm.empty')}
      header={
        <View style={{ padding: 16, gap: 12 }}>
          <Text variant="heading" accessibilityRole="header">
            {t('mon.adm.subs.plans')}
          </Text>
          {(plans.data?.items ?? []).map((p) => (
            <PlanEditor key={`${p.code}-${p.priceUsdMinor}-${p.priceCdfMinor}`} plan={p} />
          ))}
          <Button variant="secondary" label={t('adm.subs.renew')} loading={renew.isPending} onPress={() => alertConfirm(t('adm.subs.renew'), t('adm.subs.renew'), [{ text: t('adm.cancel'), style: 'cancel' }, { text: t('adm.subs.renew'), onPress: () => renew.mutate() }])} />
          {renewed ? <Text variant="small" accessibilityLiveRegion="polite">{renewed.text}</Text> : null}
          <Chips value={status} onChange={setStatus} options={[{ value: 'active', label: t('mon.status.active') }, { value: 'expired', label: t('mon.status.expired') }]} />
        </View>
      }
      renderItem={({ item }) => <SubCard s={item} />}
    />
  );
}
