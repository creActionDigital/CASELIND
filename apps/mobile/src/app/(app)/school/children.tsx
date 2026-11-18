import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { answerGuardianship, fetchChildClasses, fetchChildFees, fetchChildren, fetchGuardianships, guardianKeys } from '../../../school/guardians-api';
import { feeSummary } from '../../../school/guardians-logic';
import { formatMinor } from '../../../seller/money';
import { Card, Loading, SectionTitle } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { Badge, Button, ErrorState, Text } from '../../../ui';

/** Un enfant suivi : statut des frais (payé ou non), classes et annonces. Rien sur les autres élèves. */
function Child({ studentId, name, school, relation, onStop }: { studentId: string; name: string; school: string; relation: string; onStop: () => void }) {
  const { t, locale } = useI18n();
  const fees = useQuery({ queryKey: guardianKeys.fees(studentId), queryFn: () => fetchChildFees(studentId) });
  const classes = useQuery({ queryKey: guardianKeys.classes(studentId), queryFn: () => fetchChildClasses(studentId) });
  const sum = feeSummary(fees.data?.items ?? []);
  return (
    <Card>
      <Text variant="bodyStrong">{name}</Text>
      <Text variant="small" muted>
        {school}
        {relation ? ` · ${relation}` : ''}
      </Text>
      {fees.isError ? <ErrorState error={fees.error} onRetry={() => fees.refetch()} /> : null}
      {fees.data ? <Text variant="small">{fees.data.items.length === 0 ? t('guardians.me.noFees') : t('guardians.me.fees', sum)}</Text> : null}
      {fees.data?.items.map((f) => (
        <View key={f.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="small" style={{ flex: 1 }}>
            {f.title} · {formatMinor(f.amountMinor, f.currency, locale)}
            {f.dueOn ? ` · ${t('fees.due', { date: f.dueOn })}` : ''}
          </Text>
          <Badge tone="neutral" label={f.paid ? t('fees.status.paid') : t('fees.status.unpaid')} />
        </View>
      ))}
      {classes.isError ? <ErrorState error={classes.error} onRetry={() => classes.refetch()} /> : null}
      {classes.data?.items.map((c) => (
        <View key={c.class.id} style={{ gap: spacing.xs }}>
          <Text variant="bodyStrong">
            {t('guardians.me.classes')} : {c.class.name}
            {c.class.yearLabel ? ` · ${c.class.yearLabel}` : ''}
          </Text>
          {c.lessons.map((l) => (
            <Text key={l.id} variant="small">
              {t(`school.day.${l.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7}` as const)} {l.startsAt}–{l.endsAt} · {l.subject}
              {l.room ? ` · ${l.room}` : ''}
            </Text>
          ))}
          <Text variant="small" muted>
            {t('guardians.me.news')}
          </Text>
          {c.announcements.length === 0 ? <Text variant="small">{t('guardians.me.noNews')}</Text> : null}
          {c.announcements.slice(0, 5).map((a) => (
            <Text key={a.id} variant="small">
              {a.title} : {a.body}
            </Text>
          ))}
        </View>
      ))}
      <Button variant="ghost" label={t('guardians.me.stop')} onPress={onStop} />
    </Card>
  );
}

/** Mes enfants : invitations d'un établissement à accepter ou refuser, puis les enfants suivis. */
export default function MyChildren() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const links = useQuery({ queryKey: guardianKeys.mine, queryFn: fetchGuardianships });
  const children = useQuery({ queryKey: guardianKeys.children, queryFn: fetchChildren });
  const answer = useMutation({
    mutationFn: (v: { id: string; answer: 'accept' | 'decline' }) => answerGuardianship(v.id, v.answer),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: guardianKeys.mine });
      void qc.invalidateQueries({ queryKey: guardianKeys.children });
    },
  });
  const pending = links.data?.items.filter((l) => l.status === 'pending') ?? [];
  return (
    <>
      <Stack.Screen options={{ title: t('guardians.me.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {links.isPending || children.isPending ? <Loading /> : null}
        {links.isError ? <ErrorState error={links.error} onRetry={() => links.refetch()} /> : null}
        {pending.length > 0 ? <SectionTitle>{t('guardians.me.invites')}</SectionTitle> : null}
        {pending.map((l) => (
          <Card key={l.id}>
            <Text>{t('guardians.me.invite', { school: l.schoolName, student: l.studentDisplayName })}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button label={t('guardians.me.accept')} loading={answer.isPending} onPress={() => answer.mutate({ id: l.id, answer: 'accept' })} />
              <Button variant="secondary" label={t('guardians.me.decline')} loading={answer.isPending} onPress={() => answer.mutate({ id: l.id, answer: 'decline' })} />
            </View>
          </Card>
        ))}
        <SectionTitle>{t('guardians.me.children')}</SectionTitle>
        {children.isError ? <ErrorState error={children.error} onRetry={() => children.refetch()} /> : null}
        {children.data?.items.length === 0 ? <Text muted>{t('guardians.me.none')}</Text> : null}
        {children.data?.items.map((c) => (
          <Child key={c.id} studentId={c.studentId} name={c.displayName} school={c.schoolName} relation={c.relation} onStop={() => answer.mutate({ id: c.id, answer: 'decline' })} />
        ))}
      </ScrollView>
    </>
  );
}
