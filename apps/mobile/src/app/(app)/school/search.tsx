import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchSchools, schsk } from '../../../school/scholarships-api';
import { useDebouncedValue } from '../../../search/api';
import { Card, PagedList } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Text, TextField } from '../../../ui';

/** Établissements : recherche par nom et par ville ; champs publics seulement (jamais de classe ni d'élève). */
export default function Schools() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [cityText, setCityText] = useState('');
  const q = useDebouncedValue(text.trim());
  const city = useDebouncedValue(cityText.trim());
  const filters = useMemo(() => ({ q, city }), [q, city]);
  const query = useInfiniteQuery({
    queryKey: schsk.schools(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchSchools(filters, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const header = (
    <View style={styles.header}>
      <TextField label={t('school.search.name')} value={text} onChangeText={setText} returnKeyType="search" />
      <TextField label={t('school.city')} value={cityText} onChangeText={setCityText} returnKeyType="search" />
    </View>
  );
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('school.search.title') }} />
      <PagedList
        query={query}
        keyExtractor={(s) => s.id}
        header={header}
        renderItem={({ item }) => (
          <View style={styles.pad}>
            <Card label={item.name}>
              <Text variant="bodyStrong">{item.name}</Text>
              {item.city ? (
                <Text variant="small" muted>
                  {item.city}
                </Text>
              ) : null}
              {item.verified ? <Badge tone="primary" label={t('school.verified')} /> : null}
            </Card>
          </View>
        )}
        empty={{ icon: 'school-outline', title: t('school.search.emptyTitle'), body: t('school.search.emptyBody') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: spacing.lg, gap: spacing.sm },
  pad: {},
});
