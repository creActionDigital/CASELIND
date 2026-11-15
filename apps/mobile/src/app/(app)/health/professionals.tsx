import type { Professional, ProfessionalKind } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fetchDirectory, proKeys } from '../../../health/api';
import { PRO_KINDS, proKindKey } from '../../../health/logic';
import { useI18n } from '../../../i18n';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Text } from '../../../ui';

/** Annuaire : uniquement les professionnels dont l'agrément a été vérifié ; jamais le numéro d'agrément. */
export default function HealthDirectory() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [kind, setKind] = useState<ProfessionalKind | ''>('');
  const query = useInfiniteQuery({
    queryKey: proKeys.directory(kind),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchDirectory(kind, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const header = (
    <View style={styles.header}>
      <Text variant="small" muted style={styles.pad}>
        {t('health.directoryNote')}
      </Text>
      <Chips options={[{ value: '' as const, label: t('health.all') }, ...PRO_KINDS.map((k) => ({ value: k, label: t(proKindKey(k)) }))]} value={kind} onChange={(v) => setKind(v === kind ? '' : v)} />
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('health.directory') }} />
      <PagedList
        query={query}
        keyExtractor={(p: Professional) => p.userId}
        header={header}
        renderItem={({ item }) => (
          <Card onPress={() => router.push({ pathname: '/health/book', params: { professionalId: item.userId, name: item.displayName } })} label={item.displayName} style={styles.card}>
            <Text variant="bodyStrong">{item.displayName}</Text>
            <Text variant="small" muted>
              {item.specialty || t(proKindKey(item.kind))} · {item.city}
            </Text>
            <Badge tone="neutral" label={t(proKindKey(item.kind))} />
            {item.bio ? <Text variant="small">{item.bio}</Text> : null}
          </Card>
        )}
        empty={{ icon: 'medkit-outline', title: t('health.directoryEmpty') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingTop: spacing.sm, gap: spacing.sm },
  pad: { paddingHorizontal: spacing.lg },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
});
