import type { Certificate, Course, Enrollment } from '@caselind/contracts';
import { useInfiniteQuery, useQuery, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { eduKeys, fetchCertificates, fetchEnrollments, fetchMyCourses } from '../../../education/api';
import { useI18n } from '../../../i18n';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, EmptyState, Text } from '../../../ui';

type Tab = 'learning' | 'teaching' | 'certificates';

/** Mon activité : cours suivis, cours créés, certificats obtenus. */
export default function MyEducation() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('learning');
  const next = <T extends { nextCursor: string | null }>(last: T) => last.nextCursor ?? undefined;
  const learning = useInfiniteQuery({ queryKey: eduKeys.enrollments, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => fetchEnrollments(pageParam), getNextPageParam: next });
  const teaching = useInfiniteQuery({ queryKey: eduKeys.authored, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => fetchMyCourses(pageParam), getNextPageParam: next });
  const certs = useQuery({ queryKey: eduKeys.certificates, queryFn: fetchCertificates, enabled: tab === 'certificates' });

  const tabs = (
    <View style={styles.tabs}>
      <Chips options={(['learning', 'teaching', 'certificates'] as const).map((k) => ({ value: k, label: t(`education.tab.${k}`) }))} value={tab} onChange={setTab} />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('education.mine') }} />
      {tab === 'learning' ? (
        <PagedList
          header={tabs}
          query={learning as UseInfiniteQueryResult<InfiniteData<{ items: Enrollment[]; nextCursor: string | null }>>}
          keyExtractor={(e: Enrollment) => e.courseId}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/education/[id]', params: { id: item.courseId } })} label={item.title} style={styles.card}>
              <Text variant="bodyStrong">{item.title}</Text>
              <Text variant="small" muted>
                {t('education.progress', { n: item.progressPercent })}
              </Text>
              {item.certificateCode ? <Badge tone="neutral" label={t('education.certificate', { code: item.certificateCode })} /> : null}
            </Card>
          )}
          empty={{ icon: 'school-outline', title: t('education.learningEmpty') }}
        />
      ) : tab === 'teaching' ? (
        <PagedList
          header={tabs}
          query={teaching as UseInfiniteQueryResult<InfiniteData<{ items: Course[]; nextCursor: string | null }>>}
          keyExtractor={(c: Course) => c.id}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/education/[id]', params: { id: item.id } })} label={item.title} style={styles.card}>
              <Text variant="bodyStrong">{item.title}</Text>
              <Badge tone="neutral" label={t(item.status === 'published' ? 'education.published' : 'education.draft')} />
            </Card>
          )}
          empty={{ icon: 'create-outline', title: t('education.teachingEmpty') }}
        />
      ) : (
        <View style={styles.flex}>
          {tabs}
          {certs.data?.items.length === 0 ? <EmptyState icon="ribbon-outline" title={t('education.certificatesEmpty')} /> : null}
          {certs.data?.items.map((c: Certificate) => (
            <Card key={c.code} style={styles.card}>
              <Text variant="bodyStrong">{c.courseTitle}</Text>
              <Text variant="small" muted>
                {c.code} · {new Date(c.issuedAt).toLocaleDateString(locale)}
              </Text>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabs: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
});
