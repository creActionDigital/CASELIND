import type { NaturalFilters, NaturalSearchResult } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { assistKeys, fetchNaturalSearch, fetchNaturalWith } from '../ai/assist-api';
import { filterChips, removeFilter, type FilterChip } from '../ai/assist-logic';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';
import { radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, EmptyState, ErrorState, Text, TextField } from '../ui';
import { OrgHitRow, ProductHitRow } from './rows';

/** « Décrire ce que je cherche » : une phrase devient des filtres modifiables (puces), puis les résultats. */
export function NaturalSearch({ onBack }: { onBack: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState<string | null>(null);
  const [edited, setEdited] = useState<NaturalSearchResult | null>(null);

  const query = useQuery({ queryKey: assistKeys.natural(q ?? ''), enabled: q !== null, queryFn: () => fetchNaturalSearch(q as string) });
  const again = useMutation({ mutationFn: (f: NaturalFilters) => fetchNaturalWith(f), onSuccess: setEdited });
  const data = edited ?? query.data;
  const filters = data?.interpretation.filters;

  function go() {
    const phrase = raw.trim();
    if (phrase.length < 2) return;
    setEdited(null);
    setQ(phrase);
  }

  function chipLabel(c: FilterChip): string {
    if (c.key === 'cheapFirst') return t('natsearch.cheap');
    return c.label;
  }

  return (
    <ScrollView style={[styles.flex, { backgroundColor: colors.background }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField label={t('natsearch.mode')} placeholder={t('natsearch.placeholder')} value={raw} onChangeText={setRaw} returnKeyType="search" onSubmitEditing={go} autoFocus maxLength={200} />
      <Text variant="small" muted>
        {t('natsearch.hint')}
      </Text>
      <Button label={t('natsearch.go')} onPress={go} disabled={raw.trim().length < 2} loading={query.isFetching && !edited} />
      <Button variant="ghost" label={t('natsearch.back')} onPress={onBack} />

      {q !== null && query.isPending ? <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} /> : null}
      {again.isError ? <Text color={colors.danger}>{errorMessage(again.error, t, locale)}</Text> : null}
      {q !== null && query.isError && !data ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}

      {data && filters ? (
        <View style={styles.block}>
          <Text variant="bodyStrong">{t('natsearch.understood')}</Text>
          <View style={styles.chips}>
            {filterChips(filters).map((c) => (
              <Pressable
                key={c.key}
                accessibilityRole="button"
                accessibilityLabel={t('natsearch.remove', { label: chipLabel(c) })}
                onPress={() => again.mutate(removeFilter(filters, c.key))}
                style={({ pressed }) => [styles.chip, { backgroundColor: colors.primarySoft, opacity: pressed ? 0.7 : 1 }]}
              >
                <Text variant="small" color={colors.primary}>
                  {chipLabel(c)}
                </Text>
                <Ionicons name="close" size={14} color={colors.primary} />
              </Pressable>
            ))}
          </View>
          {filters.nearMe ? (
            <Text variant="small" muted>
              {t('natsearch.nearMe')}
            </Text>
          ) : null}
          {data.interpretation.refinedByAi ? (
            <Text variant="caption" muted>
              {t('natsearch.ai')}
            </Text>
          ) : null}

          {data.results.products.length === 0 && data.results.places.length === 0 ? (
            <EmptyState icon="search-outline" title={t('natsearch.empty')} />
          ) : null}
          {data.results.products.length > 0 ? (
            <View>
              <Text variant="heading" accessibilityRole="header">
                {t('natsearch.products')}
              </Text>
              {data.results.products.map((hit) => (
                <ProductHitRow key={hit.id} hit={hit} />
              ))}
            </View>
          ) : null}
          {data.results.places.length > 0 ? (
            <View>
              <Text variant="heading" accessibilityRole="header">
                {t('natsearch.places')}
              </Text>
              {data.results.places.map((hit) => (
                <OrgHitRow key={hit.id} hit={hit} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  block: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: TOUCH - 8, paddingHorizontal: spacing.md, borderRadius: radius.pill },
});
