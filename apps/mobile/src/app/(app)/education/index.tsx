import type { Course, CourseLevel } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { eduKeys, fetchCourses } from '../../../education/api';
import { COURSE_LEVELS, levelKey } from '../../../education/logic';
import { useI18n } from '../../../i18n';
import { useDebouncedValue } from '../../../search/api';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, IconButton, Text, TextField } from '../../../ui';

/** Catalogue des cours publiés : recherche, niveau ; accès à mon activité, à la création et à la vérification d'un certificat. */
export default function Education() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim());
  const [level, setLevel] = useState<CourseLevel | ''>('');
  const filters = useMemo(() => ({ level: level || undefined, q: q || undefined }), [level, q]);
  const query = useInfiniteQuery({
    queryKey: eduKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchCourses(filters, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const header = (
    <View style={styles.header}>
      <View style={styles.pad}>
        <TextField label={t('education.search')} value={text} onChangeText={setText} returnKeyType="search" autoCapitalize="none" />
      </View>
      <Chips
        options={[{ value: '' as const, label: t('education.all') }, ...COURSE_LEVELS.map((l) => ({ value: l, label: t(levelKey(l)) }))]}
        value={level}
        onChange={(v) => setLevel(v === level ? '' : v)}
      />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: t('education.title'),
          headerRight: () => (
            <View style={styles.actions}>
              <IconButton icon="ribbon-outline" label={t('education.verify')} onPress={() => router.push('/education/verify')} />
              <IconButton icon="albums-outline" label={t('education.mine')} onPress={() => router.push('/education/mine')} />
              <IconButton icon="add-circle-outline" label={t('education.new')} onPress={() => router.push('/education/new')} />
            </View>
          ),
        }}
      />
      <PagedList
        query={query}
        keyExtractor={(c: Course) => c.id}
        header={header}
        renderItem={({ item }) => (
          <Card onPress={() => router.push({ pathname: '/education/[id]', params: { id: item.id } })} label={item.title} style={styles.card}>
            <Text variant="bodyStrong" numberOfLines={2}>
              {item.title}
            </Text>
            <Text variant="small" muted>
              {t('education.by', { name: item.author.displayName })} · {t('education.lessons', { n: item.lessonCount })}
            </Text>
            <View style={styles.badges}>
              <Badge tone="neutral" label={t(levelKey(item.level))} />
              <Badge tone="neutral" label={item.language.toUpperCase()} />
            </View>
          </Card>
        )}
        empty={{ icon: 'school-outline', title: t('education.emptyTitle'), body: t('education.emptyBody'), actionLabel: t('education.new'), onAction: () => router.push('/education/new') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.lg },
  actions: { flexDirection: 'row' },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
  badges: { flexDirection: 'row', gap: spacing.xs },
});
