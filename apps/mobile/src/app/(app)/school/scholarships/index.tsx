import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { fetchScholarships, schsk } from '../../../../school/scholarships-api';
import { useDebouncedValue } from '../../../../search/api';
import { Card, PagedList } from '../../../../seller/ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Badge, Text, TextField } from '../../../../ui';

/** Bourses ouvertes des établissements publics ; filtre par ville facultatif. */
export default function Scholarships() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [cityText, setCityText] = useState('');
  const city = useDebouncedValue(cityText.trim());
  const key = useMemo(() => schsk.list(city), [city]);
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchScholarships(city, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('school.scholarships.title') }} />
      <PagedList
        query={query}
        keyExtractor={(s) => s.id}
        header={
          <View style={styles.header}>
            <TextField label={t('school.city')} value={cityText} onChangeText={setCityText} returnKeyType="search" />
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.pad}>
            <Card label={item.title} onPress={() => router.push(`/school/scholarships/${item.id}` as never)}>
              <Text variant="bodyStrong">{item.title}</Text>
              <Text variant="small" muted>
                {item.school.name}
                {item.school.city ? ` · ${item.school.city}` : ''}
              </Text>
              <Text variant="small" muted>
                {item.deadline ? t('school.scholarships.deadline', { date: item.deadline }) : t('school.scholarships.noDeadline')}
              </Text>
              {item.school.verified ? <Badge tone="primary" label={t('school.verified')} /> : null}
            </Card>
          </View>
        )}
        empty={{ icon: 'ribbon-outline', title: t('school.scholarships.emptyTitle'), body: t('school.scholarships.emptyBody') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: spacing.lg },
  pad: {},
});
