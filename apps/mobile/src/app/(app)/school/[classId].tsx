import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchMyClass, schk } from '../../../school/api';
import { Card, Loading, SectionTitle } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { ErrorState, Text } from '../../../ui';

/** Une classe vue par un inscrit : emploi du temps par jour, puis annonces. */
export default function ClassDetail() {
  const { t, locale } = useI18n();
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const q = useQuery({ queryKey: schk.one(classId), queryFn: () => fetchMyClass(classId) });
  const d = q.data;
  return (
    <>
      <Stack.Screen options={{ title: d?.class.name ?? t('school.title') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {q.isPending ? <Loading /> : null}
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {d ? (
          <>
            <SectionTitle>{t('school.timetable')}</SectionTitle>
            {d.lessons.length === 0 ? <Text muted>{t('school.noLessons')}</Text> : null}
            {d.lessons.map((l) => (
              <Card key={l.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <Text variant="bodyStrong">{t(`school.day.${l.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7}` as const)}</Text>
                  <Text>
                    {l.startsAt}–{l.endsAt}
                  </Text>
                </View>
                <Text>
                  {l.subject}
                  {l.room ? ` · ${l.room}` : ''}
                </Text>
              </Card>
            ))}
            <SectionTitle>{t('school.announcements')}</SectionTitle>
            {d.announcements.length === 0 ? <Text muted>{t('school.noNews')}</Text> : null}
            {d.announcements.map((a) => (
              <Card key={a.id}>
                <Text variant="bodyStrong">{a.title}</Text>
                <Text variant="caption" muted>
                  {new Date(a.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                <Text>{a.body}</Text>
              </Card>
            ))}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
