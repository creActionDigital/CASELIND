import type { SubscriptionResponse } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useI18n } from '../i18n';
import { alertConfirm } from '../lib/confirm';
import { errorMessage } from '../lib/errors';
import { uuidv4 } from '../lib/uuid';
import { Card, Chips, Loading } from '../seller/ui';
import { formatMoney } from '../shop/format';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Badge, Button, ErrorState, Text } from '../ui';
import { WALLET_CURRENCIES } from '../wallet/amount';
import { cancelSubscription, fetchPlans, fetchSubscription, renewSubscription, setAutoRenew, subscribe } from './api';
import { planNameKey, planPeriodKey, planPrice, plansFor, subscriptionStatusKey } from './logic';
import { PinSheet } from './PinSheet';

type Pay = { kind: 'subscribe'; code: string } | { kind: 'renew' };

/**
 * Souscrire, renouveler, résilier et régler le renouvellement automatique d'un abonnement : Premium (sans `orgId`) ou forfait pro
 * d'une organisation. Paiement en mode test par le portefeuille, avec code PIN ; clé d'idempotence gardée tant que la demande ne change pas.
 */
export function PlanPanel({ orgId }: { orgId?: string }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const audience = orgId ? 'org' : 'user';
  const [currency, setCurrency] = useState<string>(WALLET_CURRENCIES[0]);
  const [auto, setAuto] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pay, setPay] = useState<Pay | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<{ sig: string; id: string } | null>(null);

  const plans = useQuery({ queryKey: ['premium-plans'], queryFn: fetchPlans, staleTime: 60_000 });
  const state = useQuery({ queryKey: ['subscription', orgId ?? 'me'], queryFn: () => fetchSubscription(orgId) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['subscription'] });
    void qc.invalidateQueries({ queryKey: ['premium-badge'] });
    void qc.invalidateQueries({ queryKey: ['subscription-payments'] });
    void qc.invalidateQueries({ queryKey: ['wallet'] });
    void qc.invalidateQueries({ queryKey: ['wallet-transactions'] });
  };

  const sub = state.data?.subscription ?? null;
  const live = !!sub && sub.status === 'active';
  const list = plansFor(plans.data?.items ?? [], audience);
  const plan = list.find((p) => p.code === (selected ?? list[0]?.code));
  const money = (m: number, c = currency) => formatMoney(m, c, locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);
  const subPlan = sub ? plans.data?.items.find((p) => p.code === sub.planCode) : undefined;

  const doPay = async (pin: string) => {
    if (!pay) return;
    const sig = JSON.stringify([pay, currency, auto, orgId]);
    if (key.current?.sig !== sig) key.current = { sig, id: uuidv4() };
    const clientId = key.current.id;
    const r: SubscriptionResponse =
      pay.kind === 'subscribe'
        ? await subscribe({ clientId, planCode: pay.code, currency, autoRenew: auto, pin, orgId })
        : await renewSubscription({ clientId, pin, orgId });
    key.current = null;
    setPay(null);
    setDone(
      t(pay.kind === 'subscribe' ? 'mon.subscribe.done' : 'mon.renew.done', { date: date(r.subscription.currentPeriodEnd), receipt: r.payment.receiptNo }),
    );
    refresh();
  };

  const cancel = useMutation({
    mutationFn: () => cancelSubscription(orgId),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorMessage(e, t, locale)),
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) => setAutoRenew(on, orgId),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e, t, locale)),
  });

  if (plans.isPending || state.isPending) return <Loading />;
  if (plans.isError) return <ErrorState error={plans.error} onRetry={() => plans.refetch()} />;
  if (state.isError) return <ErrorState error={state.error} onRetry={() => state.refetch()} />;

  const pinHint =
    pay?.kind === 'subscribe' && plan
      ? t('mon.subscribe.pinHint', { amount: money(planPrice(plan, currency)), plan: t(planNameKey(plan.code)) })
      : sub && subPlan
        ? t('mon.renew.pinHint', { amount: money(planPrice(subPlan, sub.currency), sub.currency) })
        : '';

  return (
    <View style={styles.gap}>
      {done ? (
        <Text color={colors.success} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {done}
        </Text>
      ) : null}
      {error ? (
        <Text color={colors.danger} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {sub ? (
        <Card style={styles.gap}>
          <View style={styles.rowBetween}>
            <Text variant="heading">{t(planNameKey(sub.planCode))}</Text>
            <Badge tone={live ? 'primary' : 'neutral'} label={t(subscriptionStatusKey(sub))} />
          </View>
          <Text muted>{t('mon.validUntil', { date: date(sub.currentPeriodEnd) })}</Text>
          {live ? (
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text>{t('mon.autoRenew')}</Text>
                <Text variant="small" muted>
                  {t('mon.autoRenew.hint')}
                </Text>
              </View>
              <Switch
                accessibilityRole="switch"
                accessibilityLabel={t('mon.autoRenew')}
                accessibilityState={{ checked: sub.autoRenew }}
                value={sub.autoRenew}
                disabled={toggle.isPending}
                onValueChange={(v) => toggle.mutate(v)}
              />
            </View>
          ) : null}
          <Button label={t('mon.renew')} onPress={() => { setDone(null); setPay({ kind: 'renew' }); }} />
          {live && !sub.cancelledAt ? (
            <Button
              variant="secondary"
              label={t('mon.cancel')}
              loading={cancel.isPending}
              onPress={() => alertConfirm(t('mon.cancel'), t('mon.cancel.confirm'), [{ text: t('mon.cancel.keep'), style: 'cancel' }, { text: t('mon.cancel'), style: 'destructive', onPress: () => cancel.mutate() }])}
            />
          ) : null}
        </Card>
      ) : null}

      {!live ? (
        <View style={styles.gap}>
          <Text variant="small" muted>
            {t('mon.currency')}
          </Text>
          <Chips value={currency} onChange={setCurrency} options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} scroll={false} />
          {list.map((p) => {
            const on = p.code === plan?.code;
            return (
              <Pressable
                key={p.code}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${t(planNameKey(p.code))}, ${t(planPeriodKey(p.period), { price: money(planPrice(p, currency)) })}`}
                onPress={() => setSelected(p.code)}
                style={[styles.plan, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySoft : colors.surface }]}
              >
                <Text style={{ fontWeight: '700' }}>{t(planNameKey(p.code))}</Text>
                <Text muted>{t(planPeriodKey(p.period), { price: money(planPrice(p, currency)) })}</Text>
              </Pressable>
            );
          })}
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text>{t('mon.autoRenew')}</Text>
              <Text variant="small" muted>
                {t('mon.autoRenew.hint')}
              </Text>
            </View>
            <Switch accessibilityRole="switch" accessibilityLabel={t('mon.autoRenew')} accessibilityState={{ checked: auto }} value={auto} onValueChange={setAuto} />
          </View>
          <Button label={t('mon.subscribe')} disabled={!plan} onPress={() => { setDone(null); setError(null); setPay({ kind: 'subscribe', code: plan!.code }); }} />
        </View>
      ) : null}

      <Button variant="ghost" label={t('mon.history')} onPress={() => router.push('/premium/history')} />
      <PinSheet visible={pay !== null} hint={pinHint} onClose={() => setPay(null)} onSubmit={doPay} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  plan: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, minHeight: 44, gap: spacing.xs },
});
