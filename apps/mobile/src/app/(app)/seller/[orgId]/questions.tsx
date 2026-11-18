import type { OrgQuestion } from '@caselind/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { useMembership } from '../../../../seller/api';
import { canEditProfile } from '../../../../seller/permissions';
import { Card, Chips, PagedList, sellerErrorMessage } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, Text, TextField } from '../../../../ui';
import { answerQuestion, deleteQuestion, fetchOrgQuestions, reviewsKeys } from '../../../../vitrine/reviews-api';
import { cleanAnswer } from '../../../../vitrine/reviews-logic';

type Filter = 'pending' | 'answered';

/** Questions des visiteurs de la page publique (permission `org.profile.edit` pour répondre ou supprimer). */
export default function SellerQuestions() {
  const { t } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role } = useMembership(orgId);
  const canAnswer = canEditProfile(role);
  const [filter, setFilter] = useState<Filter>('pending');
  const q = useInfiniteQuery({
    queryKey: [...reviewsKeys.staffQuestions(orgId), filter],
    queryFn: ({ pageParam }) => fetchOrgQuestions(orgId, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <>
      <Stack.Screen options={{ title: t('vitrine.questions.seller.title') }} />
      <PagedList<OrgQuestion>
        query={q}
        keyExtractor={(x) => x.id}
        header={
          <Chips
            options={(['pending', 'answered'] as Filter[]).map((f) => ({ value: f, label: t(`vitrine.questions.seller.${f}` as const) }))}
            value={filter}
            onChange={setFilter}
          />
        }
        empty={{ icon: 'help-circle-outline', title: t('vitrine.questions.seller.emptyTitle'), body: t('vitrine.questions.seller.emptyBody') }}
        renderItem={({ item }) => <QuestionCard orgId={orgId} question={item} canAnswer={canAnswer} />}
      />
    </>
  );
}

function QuestionCard({ orgId, question: x, canAnswer }: { orgId: string; question: OrgQuestion; canAnswer: boolean }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(x.answer ?? '');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: reviewsKeys.staffQuestions(orgId) });
  const answer = useMutation({
    mutationFn: () => {
      const a = cleanAnswer(text);
      if (!a) throw new Error('answer');
      return answerQuestion(orgId, x.id, a);
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError: (e) => setError(e instanceof Error && e.message === 'answer' ? t('vitrine.questions.seller.err.answer') : sellerErrorMessage(e, t, locale)),
  });
  const remove = useMutation({ mutationFn: () => deleteQuestion(orgId, x.id), onSuccess: refresh, onError: (e) => setError(sellerErrorMessage(e, t, locale)) });
  const confirmDelete = () =>
    Alert.alert(x.question, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('vitrine.questions.seller.delete'), style: 'destructive', onPress: () => remove.mutate() },
    ]);
  return (
    <Card>
      <Text variant="caption" muted>
        {t('vitrine.questions.seller.from', { name: x.asker.displayName })} · {new Date(x.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
      </Text>
      <Text variant="bodyStrong">{x.question}</Text>
      {x.answer && !editing ? <Text>{x.answer}</Text> : null}
      {canAnswer && !editing ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button variant="secondary" label={x.answer ? t('vitrine.questions.seller.editAnswer') : t('vitrine.questions.seller.answer')} onPress={() => setEditing(true)} />
          <Button variant="ghost" label={t('vitrine.questions.seller.delete')} loading={remove.isPending} onPress={confirmDelete} />
        </View>
      ) : null}
      {editing ? (
        <View style={{ marginTop: spacing.sm }}>
          <TextField label={t('vitrine.questions.seller.fieldAnswer')} value={text} onChangeText={setText} multiline maxLength={1000} />
          <Button label={t('vitrine.questions.seller.send')} loading={answer.isPending} disabled={!text.trim()} onPress={() => answer.mutate()} />
          <Button variant="ghost" label={t('common.cancel')} disabled={answer.isPending} onPress={() => setEditing(false)} />
        </View>
      ) : null}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
