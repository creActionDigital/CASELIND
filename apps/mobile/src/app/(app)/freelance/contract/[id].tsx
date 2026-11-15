import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { approveMilestone, cancelContract, deliverMilestone, fetchContract, frKeys, openDispute, reviewContract, reviseMilestone } from '../../../../freelance/api';
import { canCancel, canDispute, canReview, contractStatusKey, freelanceErrorKey, milestoneActions, milestoneStatusKey, type MilestoneAction } from '../../../../freelance/logic';
import { formatMoney } from '../../../../shop/format';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

/** Contrat : jalons (livrer, approuver, demander une révision), annulation, litige, évaluation. Paiement hors CASELIND. */
export default function ContractDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contractId = String(id);
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: frKeys.contract(contractId), queryFn: () => fetchContract(contractId) });

  const done = () => {
    setError(null);
    setNote('');
    void qc.invalidateQueries({ queryKey: frKeys.all });
  };
  const fail = (e: unknown) => {
    const key = freelanceErrorKey(e);
    if (key) setError(t(key));
    else setError(e instanceof ApiRequestError && e.status === 400 ? t('freelance.err.invalid') : errorMessage(e, t, locale));
    void qc.invalidateQueries({ queryKey: frKeys.all });
  };
  const act = useMutation({
    mutationFn: (v: { mid: string; action: MilestoneAction }) =>
      v.action === 'deliver' ? deliverMilestone(contractId, v.mid, note.trim()) : v.action === 'approve' ? approveMilestone(contractId, v.mid) : reviseMilestone(contractId, v.mid, note.trim()),
    onSuccess: done,
    onError: fail,
  });
  const cancel = useMutation({ mutationFn: () => cancelContract(contractId), onSuccess: done, onError: fail });
  const dispute = useMutation({ mutationFn: () => openDispute(contractId, reason.trim()), onSuccess: () => { setReason(''); done(); }, onError: fail });
  const review = useMutation({ mutationFn: () => reviewContract(contractId, rating, comment.trim()), onSuccess: done, onError: fail });

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLiveRegion="polite" accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (q.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Screen>
    );
  }
  const c = q.data;
  const money = (n: number) => formatMoney(n, c.currency, locale);
  const other = c.role === 'client' ? c.freelancer : c.client;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('freelance.title') }} />
      <View style={styles.body}>
        <Text variant="title" accessibilityRole="header">
          {c.missionTitle}
        </Text>
        <View style={styles.badges}>
          <Badge tone="neutral" label={t(contractStatusKey(c.status))} />
        </View>
        <Text variant="heading">{money(c.amountMinor)}</Text>
        <Text muted>{t(c.role === 'client' ? 'freelance.contract.freelancer' : 'freelance.contract.client', { name: other.displayName })}</Text>
        <View style={[styles.note, { backgroundColor: colors.surface }]}>
          <Text variant="small" muted>
            {t('freelance.contract.paymentExternal')}
          </Text>
        </View>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {c.milestones.map((m) => {
          const actions = milestoneActions(c.role, c.status, m);
          return (
            <View key={m.id} style={[styles.card, { backgroundColor: colors.surface }]}>
              <View style={styles.row}>
                <Text variant="bodyStrong">{m.title}</Text>
                <Text>{money(m.amountMinor)}</Text>
              </View>
              <Badge tone="neutral" label={t(milestoneStatusKey(m.status))} />
              {m.note ? <Text variant="small">{m.note}</Text> : null}
              {actions.length > 0 ? (
                <>
                  {actions.includes('deliver') || actions.includes('revision') ? <TextField label={t(actions.includes('revision') ? 'freelance.revisionNote' : 'freelance.noteLabel')} value={note} onChangeText={setNote} multiline maxLength={2000} /> : null}
                  {actions.map((a) => (
                    <Button
                      key={a}
                      variant={a === 'revision' ? 'secondary' : 'primary'}
                      label={t(a === 'deliver' ? 'freelance.deliver' : a === 'approve' ? 'freelance.approve' : 'freelance.revision')}
                      loading={act.isPending && act.variables?.mid === m.id && act.variables.action === a}
                      disabled={a === 'revision' && note.trim().length < 3}
                      onPress={() => act.mutate({ mid: m.id, action: a })}
                    />
                  ))}
                </>
              ) : null}
            </View>
          );
        })}

        {c.dispute ? (
          <View style={[styles.note, { backgroundColor: colors.surface }]}>
            <Text variant="small">{c.dispute.status === 'open' ? t('freelance.disputeOpen') : t('freelance.disputeResolved', { resolution: c.dispute.resolution })}</Text>
          </View>
        ) : null}

        {canCancel(c) ? <Button variant="secondary" label={t('freelance.cancel')} loading={cancel.isPending} onPress={() => cancel.mutate()} /> : null}
        {canDispute(c) ? (
          <>
            <TextField label={t('freelance.disputeReason')} value={reason} onChangeText={setReason} multiline maxLength={2000} />
            <Button variant="danger" label={t('freelance.dispute')} loading={dispute.isPending} disabled={reason.trim().length < 5} onPress={() => dispute.mutate()} />
          </>
        ) : null}

        {c.theirReview ? <Text variant="small">{t('freelance.theirReview', { n: c.theirReview.rating })}</Text> : null}
        {c.myReview ? <Text variant="small">{t('freelance.rating', { n: c.myReview.rating })}</Text> : null}
        {canReview(c) ? (
          <>
            <View style={styles.row}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Button key={n} variant={n === rating ? 'primary' : 'secondary'} label={String(n)} accessibilityLabel={t('freelance.rating', { n })} onPress={() => setRating(n)} />
              ))}
            </View>
            <TextField label={t('freelance.reviewBody')} value={comment} onChangeText={setComment} multiline maxLength={1000} />
            <Button label={t('freelance.review')} loading={review.isPending} onPress={() => review.mutate()} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  badges: { flexDirection: 'row', gap: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs },
  card: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  note: { borderRadius: radius.md, padding: spacing.md },
});
