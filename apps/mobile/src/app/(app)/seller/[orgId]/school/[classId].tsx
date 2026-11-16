import type { SchoolRole } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { addLesson, announce, enroll, fetchMembers, schk, unenroll } from '../../../../../school/api';
import { Card, Chips, Loading, SectionTitle, sellerErrorMessage } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { Button, ErrorState, Text, TextField } from '../../../../../ui';

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Gestion d'une classe par l'établissement : inscrits, emploi du temps, annonces. */
export default function ManageClass() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const { orgId, classId } = useLocalSearchParams<{ orgId: string; classId: string }>();
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<SchoolRole>('student');
  const [lesson, setLesson] = useState({ weekday: '1', startsAt: '', endsAt: '', subject: '', room: '' });
  const [news, setNews] = useState({ title: '', body: '' });
  const members = useQuery({ queryKey: schk.members(orgId, classId), queryFn: () => fetchMembers(orgId, classId) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: schk.members(orgId, classId) });
    void qc.invalidateQueries({ queryKey: schk.classes(orgId) });
  };
  const opts = { onMutate: () => setError(null), onError: (e: unknown) => setError(sellerErrorMessage(e, t, locale)) };

  const add = useMutation({ ...opts, mutationFn: () => enroll(orgId, classId, { handle: handle.trim(), role }), onSuccess: () => { setHandle(''); refresh(); } });
  const remove = useMutation({ ...opts, mutationFn: (h: string) => unenroll(orgId, classId, h), onSuccess: refresh });
  const lessonOk = HHMM.test(lesson.startsAt) && HHMM.test(lesson.endsAt) && lesson.endsAt > lesson.startsAt && lesson.subject.trim() && /^[1-7]$/.test(lesson.weekday);
  const addL = useMutation({
    ...opts,
    mutationFn: () => addLesson(orgId, classId, { weekday: Number(lesson.weekday), startsAt: lesson.startsAt, endsAt: lesson.endsAt, subject: lesson.subject.trim(), room: lesson.room.trim() }),
    onSuccess: () => setLesson((l) => ({ ...l, subject: '', room: '' })),
  });
  const post = useMutation({ ...opts, mutationFn: () => announce(orgId, classId, { title: news.title.trim(), body: news.body.trim() }), onSuccess: () => setNews({ title: '', body: '' }) });

  return (
    <>
      <Stack.Screen options={{ title: t('school.staff.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Button variant="secondary" label={t('fees.staff.manage')} onPress={() => router.push(`/seller/${orgId}/school/fees/${classId}` as never)} />
        <SectionTitle>{t('school.staff.enroll')}</SectionTitle>
        <TextField label={t('school.staff.handle')} value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} />
        <Chips
          scroll={false}
          options={(['student', 'parent', 'teacher'] as SchoolRole[]).map((r) => ({ value: r, label: t(`school.role.${r}` as const) }))}
          value={role}
          onChange={setRole}
        />
        <Button label={t('school.staff.add')} loading={add.isPending} disabled={!handle.trim()} onPress={() => add.mutate()} />
        {members.isPending ? <Loading /> : null}
        {members.isError ? <ErrorState error={members.error} onRetry={() => members.refetch()} /> : null}
        {members.data?.items.map((m) => (
          <Card key={m.handle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {m.displayName}
                </Text>
                <Text variant="small" muted>
                  @{m.handle} · {t(`school.role.${m.role}` as const)}
                </Text>
              </View>
              <Button variant="ghost" label={t('school.staff.remove')} disabled={remove.isPending} onPress={() => remove.mutate(m.handle)} />
            </View>
          </Card>
        ))}

        <SectionTitle>{t('school.staff.lesson')}</SectionTitle>
        <TextField label={t('school.staff.weekday')} value={lesson.weekday} onChangeText={(weekday) => setLesson((l) => ({ ...l, weekday }))} keyboardType="number-pad" maxLength={1} />
        <TextField label={t('school.staff.start')} value={lesson.startsAt} onChangeText={(startsAt) => setLesson((l) => ({ ...l, startsAt }))} maxLength={5} />
        <TextField label={t('school.staff.end')} value={lesson.endsAt} onChangeText={(endsAt) => setLesson((l) => ({ ...l, endsAt }))} maxLength={5} />
        <TextField label={t('school.staff.subject')} value={lesson.subject} onChangeText={(subject) => setLesson((l) => ({ ...l, subject }))} maxLength={80} />
        <TextField label={t('school.staff.room')} value={lesson.room} onChangeText={(room) => setLesson((l) => ({ ...l, room }))} maxLength={40} />
        <Button label={t('school.staff.lesson')} loading={addL.isPending} disabled={!lessonOk} onPress={() => addL.mutate()} />

        <SectionTitle>{t('school.staff.announce')}</SectionTitle>
        <TextField label={t('school.staff.annTitle')} value={news.title} onChangeText={(title) => setNews((n) => ({ ...n, title }))} maxLength={120} />
        <TextField label={t('school.staff.annBody')} value={news.body} onChangeText={(body) => setNews((n) => ({ ...n, body }))} multiline maxLength={2000} />
        <Button label={t('school.staff.publish')} loading={post.isPending} disabled={!news.title.trim() || !news.body.trim()} onPress={() => post.mutate()} />
      </ScrollView>
    </>
  );
}
