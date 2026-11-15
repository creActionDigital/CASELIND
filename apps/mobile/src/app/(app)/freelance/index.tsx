import type { Mission } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchMissions, frKeys } from '../../../freelance/api';
import { useDebouncedValue } from '../../../search/api';
import { Card, PagedList } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { IconButton, Text, TextField } from '../../../ui';

/** Missions freelance ouvertes, récentes d'abord ; accès à mon activité et à la publication. */
export default function Freelance() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim());
  const query = useInfiniteQuery({
    queryKey: frKeys.list(q),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchMissions(q, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: t('freelance.title'),
          headerRight: () => (
            <View style={styles.actions}>
              <IconButton icon="albums-outline" label={t('freelance.mine')} onPress={() => router.push('/freelance/mine')} />
              <IconButton icon="add-circle-outline" label={t('freelance.new')} onPress={() => router.push('/freelance/new')} />
            </View>
          ),
        }}
      />
      <PagedList
        query={query}
        keyExtractor={(m: Mission) => m.id}
        header={
          <View style={styles.pad}>
            <TextField label={t('freelance.search')} value={text} onChangeText={setText} returnKeyType="search" autoCapitalize="none" />
          </View>
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push({ pathname: '/freelance/[id]', params: { id: item.id } })} label={item.title} style={styles.card}>
            <Text variant="bodyStrong" numberOfLines={2}>
              {item.title}
            </Text>
            <Text variant="small" muted>
              {t('freelance.by', { name: item.client.displayName })}
            </Text>
            <Text variant="small">{t('freelance.budgetOf', { amount: formatMoney(item.budgetMinor, item.currency, locale) })}</Text>
          </Card>
        )}
        empty={{ icon: 'hammer-outline', title: t('freelance.emptyTitle'), body: t('freelance.emptyBody'), actionLabel: t('freelance.new'), onAction: () => router.push('/freelance/new') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  actions: { flexDirection: 'row' },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.xs },
});
