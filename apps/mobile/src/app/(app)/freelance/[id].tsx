import type { Proposal } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { acceptProposal, closeMission, fetchMission, fetchMissionProposals, frKeys, proposeOnMission, withdrawProposal } from '../../../freelance/api';
import { categoryKey, freelanceErrorKey, proposalStatusKey } from '../../../freelance/logic';
import { openReport } from '../../../report/open-report';
import { formatMoney } from '../../../shop/format';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { parseWalletAmount } from '../../../wallet/amount';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Fiche de mission : le client voit les propositions et accepte ; un freelance propose son prix et son délai. */
export default function MissionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const missionId = String(id);
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('7');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: frKeys.mission(missionId), queryFn: () => fetchMission(missionId) });
  const m = q.data;
  const proposals = useQuery({ queryKey: frKeys.proposals(missionId), queryFn: () => fetchMissionProposals(missionId), enabled: !!m?.mine });

  const refresh = () => void qc.invalidateQueries({ queryKey: frKeys.all });
  const fail = (e: unknown) => {
    const key = freelanceErrorKey(e);
    if (key) return setError(t(key));
    if (e instanceof Error && e.message === 'invalid') return setError(t('freelance.err.invalid'));
    setError(e instanceof ApiRequestError && e.status === 400 ? t('freelance.err.invalid') : errorMessage(e, t, locale));
  };
  const propose = useMutation({
    mutationFn: () => {
      const p = m ? parseWalletAmount(amount, m.currency) : { issue: 'invalid' as const };
      const d = Number(days);
      if ('issue' in p || p.minor <= 0 || !Number.isInteger(d)) throw new Error('invalid');
      return proposeOnMission(missionId, { amountMinor: p.minor, deliveryDays: d, message: message.trim() });
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: fail,
  });
  const withdraw = useMutation({ mutationFn: (pid: string) => withdrawProposal(pid), onSuccess: refresh, onError: fail });
  const accept = useMutation({
    mutationFn: (pid: string) => acceptProposal(pid),
    onSuccess: (c) => {
      refresh();
      router.replace({ pathname: '/freelance/contract/[id]', params: { id: c.id } });
    },
    onError: fail,
  });
  const close = useMutation({ mutationFn: () => closeMission(missionId), onSuccess: refresh, onError: fail });

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (q.isError || !m) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Screen>
    );
  }
  const money = (n: number) => formatMoney(n, m.currency, locale);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('freelance.title') }} />
      <View style={styles.body}>
        <Text variant="title" accessibilityRole="header">
          {m.title}
        </Text>
        <Text variant="small" muted>{t('freelance.field.category')} : {t(categoryKey(m.category))}</Text>
        <View style={styles.badges}>
          <Badge tone="neutral" label={t(`freelance.mission.${m.status}`)} />
        </View>
        <Text variant="heading">{t('freelance.budgetOf', { amount: money(m.budgetMinor) })}</Text>
        {m.deadline ? <Text muted>{t('freelance.deadlineOf', { date: m.deadline })}</Text> : null}
        <Text muted>{t('freelance.by', { name: m.client.displayName })}</Text>
        {m.description ? <Text>{m.description}</Text> : null}
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {m.mine ? (
          <>
            <Text variant="bodyStrong">{t('freelance.proposalCount', { n: m.proposalCount ?? 0 })}</Text>
            {proposals.data?.items.length === 0 ? <Text muted>{t('freelance.noProposals')}</Text> : null}
            {proposals.data?.items.map((p: Proposal) => (
              <View key={p.id} style={[styles.card, { backgroundColor: colors.surface }]}>
                <Text variant="bodyStrong">{p.freelancer.displayName}</Text>
                <Text>{t('freelance.proposalLine', { amount: money(p.amountMinor), days: p.deliveryDays })}</Text>
                {p.message ? <Text variant="small">{p.message}</Text> : null}
                <Badge tone="neutral" label={t(proposalStatusKey(p.status))} />
                {p.status === 'proposed' && m.status === 'open' ? <Button label={t('freelance.accept')} loading={accept.isPending && accept.variables === p.id} onPress={() => accept.mutate(p.id)} /> : null}
              </View>
            ))}
            {m.contractId ? <Button variant="secondary" label={t('freelance.contract.open')} onPress={() => router.push({ pathname: '/freelance/contract/[id]', params: { id: m.contractId! } })} /> : null}
            {m.status === 'open' ? <Button variant="secondary" label={t('freelance.close')} loading={close.isPending} onPress={() => close.mutate()} /> : null}
          </>
        ) : m.contractId ? (
          <Button label={t('freelance.contract.open')} onPress={() => router.push({ pathname: '/freelance/contract/[id]', params: { id: m.contractId! } })} />
        ) : m.myProposalId ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="bodyStrong">{t('freelance.proposalSent')}</Text>
            <Button variant="ghost" label={t('freelance.withdraw')} loading={withdraw.isPending} onPress={() => withdraw.mutate(m.myProposalId!)} />
          </View>
        ) : m.status === 'open' ? (
          <>
            <TextField label={t('freelance.field.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            <TextField label={t('freelance.field.days')} value={days} onChangeText={setDays} keyboardType="number-pad" maxLength={3} />
            <TextField label={t('freelance.field.message')} value={message} onChangeText={setMessage} multiline maxLength={2000} />
            <Button label={t('freelance.propose')} loading={propose.isPending} disabled={!amount.trim()} onPress={() => propose.mutate()} />
          </>
        ) : null}
        {!m.mine ? <Button variant="ghost" label={t('freelance.report')} onPress={() => openReport({ targetType: 'mission', targetId: m.id })} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  badges: { flexDirection: 'row', gap: spacing.xs },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
});
