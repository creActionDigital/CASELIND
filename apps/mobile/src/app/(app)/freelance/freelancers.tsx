import type { Freelancer, MissionCategory } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchFreelancers, frKeys } from '../../../freelance/api';
import { categoryKey, CATEGORY_VALUES } from '../../../freelance/logic';
import { useDebouncedValue } from '../../../search/api';
import { Card, Chips, PagedList } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { IconButton, Text, TextField } from '../../../ui';

/** Recherche de freelances (profils publics activés) par compétence ou catégorie. */
export default function Freelancers() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState('');
  const [category, setCategory] = useState<MissionCategory | 'all'>('all');
  const q = useDebouncedValue(text.trim());
  const query = useInfiniteQuery({
    queryKey: frKeys.freelancers(q, category),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchFreelancers(q, category === 'all' ? null : category, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: t('freelance.freelancers'),
          headerRight: () => <IconButton icon="person-circle-outline" label={t('freelance.myProfile')} onPress={() => router.push('/freelance/profile')} />,
        }}
      />
      <PagedList
        query={query}
        keyExtractor={(f: Freelancer) => f.user.id}
        header={
          <View style={styles.pad}>
            <TextField label={t('freelance.freelancers.search')} value={text} onChangeText={setText} returnKeyType="search" autoCapitalize="none" />
            <View style={styles.bleedChips}>
              <Chips
                options={[{ value: 'all' as const, label: t('freelance.all') }, ...CATEGORY_VALUES.map((c) => ({ value: c, label: t(categoryKey(c)) }))]}
                value={category}
                onChange={setCategory}
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Card label={item.title} style={styles.card}>
            <Text variant="bodyStrong" numberOfLines={2}>
              {item.title}
            </Text>
            <Text variant="small" muted>
              {item.user.displayName} · @{item.user.handle}
            </Text>
            {item.skills.length ? <Text variant="small">{item.skills.join(' · ')}</Text> : null}
            {item.rateMinor !== null && item.rateCurrency ? <Text variant="small">{t('freelance.rateOf', { amount: formatMoney(item.rateMinor, item.rateCurrency, locale) })}</Text> : null}
            {item.bio ? (
              <Text variant="small" numberOfLines={3}>
                {item.bio}
              </Text>
            ) : null}
          </Card>
        )}
        empty={{ icon: 'people-outline', title: t('freelance.freelancers.emptyTitle'), body: t('freelance.freelancers.emptyBody'), actionLabel: t('freelance.myProfile'), onAction: () => router.push('/freelance/profile') }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bleedChips: { marginHorizontal: -spacing.lg },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  card: { gap: spacing.xs },
});
