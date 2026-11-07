import type { SearchOrgHit, SearchPostHit, SearchProductHit, SearchResult, SearchScope, SearchUserHit } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useI18n, type MessageKey } from '../../i18n';
import { ApiRequestError } from '../../lib/api';
import {
  clearHistory,
  deleteHistoryEntry,
  fetchHistory,
  fetchSearch,
  searchKeys,
  setHistoryEnabled,
  useDebouncedValue,
} from '../../search/api';
import { SEARCH_TABS, effectiveQuery, groupResults, type Category } from '../../search/logic';
import { OrgHitRow, PostHitRow, ProductHitRow, UserHitRow } from '../../search/rows';
import { Chips } from '../../seller/ui';
import { spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { EmptyState, ErrorState, Text, TextField } from '../../ui';

type Row =
  | { key: string; type: 'header'; category: Category; more: boolean }
  | { key: string; type: 'user'; hit: SearchUserHit }
  | { key: string; type: 'org'; hit: SearchOrgHit }
  | { key: string; type: 'product'; hit: SearchProductHit }
  | { key: string; type: 'post'; hit: SearchPostHit };

function rowsOf(result: SearchResult, category: Category): Row[] {
  switch (category) {
    case 'users':
      return (result.users?.items ?? []).map((hit) => ({ key: `u:${hit.id}`, type: 'user' as const, hit }));
    case 'orgs':
      return (result.orgs?.items ?? []).map((hit) => ({ key: `o:${hit.id}`, type: 'org' as const, hit }));
    case 'products':
      return (result.products?.items ?? []).map((hit) => ({ key: `p:${hit.id}`, type: 'product' as const, hit }));
    case 'posts':
      return (result.posts?.items ?? []).map((hit) => ({ key: `s:${hit.id}`, type: 'post' as const, hit }));
  }
}

export default function Search() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [raw, setRaw] = useState('');
  const [tab, setTab] = useState<SearchScope>('all');
  const q = effectiveQuery(useDebouncedValue(raw));
  const typing = raw.trim().length > 0;

  const query = useInfiniteQuery({
    queryKey: searchKeys.results(q ?? '', tab),
    enabled: q !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchSearch(q as string, tab, pageParam),
    // `scope=all` n'accepte pas de curseur : la pagination se fait par catégorie.
    getNextPageParam: (last) => (tab === 'all' ? undefined : (last[tab]?.nextCursor ?? undefined)),
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 429) && count < 1,
  });

  const rows = useMemo<Row[]>(() => {
    const pages = query.data?.pages ?? [];
    if (tab === 'all') {
      const first = pages[0];
      return groupResults(first).flatMap((g) => [
        { key: `h:${g.category}`, type: 'header' as const, category: g.category, more: g.more },
        ...rowsOf(first as SearchResult, g.category),
      ]);
    }
    const category = tab as Category;
    return pages.flatMap((p) => rowsOf(p, category));
  }, [query.data, tab]);

  const showHistory = !typing;

  const empty = (() => {
    if (!typing) return null;
    if (q === null) return <EmptyState icon="search-outline" title={t('search.minChars')} />;
    if (query.isPending || (raw.trim() !== q && rows.length === 0 && query.isFetching)) {
      return <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />;
    }
    if (query.isError && rows.length === 0) {
      const limited = query.error instanceof ApiRequestError && query.error.status === 429;
      return limited ? (
        <EmptyState icon="time-outline" title={t('search.rateLimited')} actionLabel={t('common.retry')} onAction={() => query.refetch()} />
      ) : (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      );
    }
    if (rows.length === 0) {
      return <EmptyState icon="search-outline" title={t(`search.empty.${tab}` as MessageKey, { q })} />;
    }
    return null;
  })();

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.top}>
        <TextField
          label={t('search.placeholder')}
          placeholder={t('search.hint')}
          value={raw}
          onChangeText={setRaw}
          returnKeyType="search"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={100}
        />
        {typing ? <Chips options={SEARCH_TABS.map((s) => ({ value: s, label: t(`search.tab.${s}` as MessageKey) }))} value={tab} onChange={setTab} /> : null}
      </View>
      {showHistory ? (
        <History
          onPick={(entry) => {
            setRaw(entry.query);
            setTab(entry.scope);
          }}
        />
      ) : (
        <FlatList
          data={empty ? [] : rows}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={empty ?? undefined}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} /> : undefined}
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => {
            switch (item.type) {
              case 'header':
                return <CategoryHeader category={item.category} more={item.more} onMore={() => setTab(item.category)} />;
              case 'user':
                return <UserHitRow hit={item.hit} />;
              case 'org':
                return <OrgHitRow hit={item.hit} />;
              case 'product':
                return <ProductHitRow hit={item.hit} />;
              case 'post':
                return <PostHitRow hit={item.hit} />;
            }
          }}
        />
      )}
    </View>
  );
}

function CategoryHeader({ category, more, onMore }: { category: Category; more: boolean; onMore: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const title = t(`search.tab.${category}` as MessageKey);
  return (
    <View style={styles.sectionHead}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {more ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('search.moreA11y', { category: title })} onPress={onMore} hitSlop={8} style={styles.moreBtn}>
          <Text variant="small" color={colors.primary} style={{ fontWeight: '600' }}>
            {t('search.more')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Recherches récentes sous le champ vide : supprimer une entrée, tout effacer, activer/désactiver l'enregistrement. */
function History({ onPick }: { onPick: (e: { query: string; scope: SearchScope }) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const qc = useQueryClient();
  const history = useQuery({ queryKey: searchKeys.history, queryFn: fetchHistory, refetchOnMount: 'always' });
  const refresh = () => qc.invalidateQueries({ queryKey: searchKeys.history });
  const remove = useMutation({ mutationFn: deleteHistoryEntry, onSuccess: refresh });
  const clear = useMutation({ mutationFn: clearHistory, onSuccess: refresh });
  const toggle = useMutation({ mutationFn: setHistoryEnabled, onSuccess: refresh });
  const data = history.data;
  const items = data?.items ?? [];
  const enabled = toggle.isPending ? !!toggle.variables : (data?.enabled ?? true);

  return (
    <FlatList
      data={items}
      keyExtractor={(e) => e.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.histHead}>
          <View style={styles.toggleRow}>
            <View style={styles.flex}>
              <Text variant="bodyStrong">{t('search.history.toggle')}</Text>
              <Text variant="small" muted>
                {t('search.history.toggleHint')}
              </Text>
            </View>
            <Switch
              accessibilityLabel={t('search.history.toggle')}
              value={enabled}
              disabled={!data || toggle.isPending}
              onValueChange={(v) => toggle.mutate(v)}
              trackColor={{ true: colors.primary }}
            />
          </View>
          {items.length > 0 ? (
            <View style={styles.sectionHead}>
              <Text variant="heading" accessibilityRole="header">
                {t('search.history.title')}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => clear.mutate()} hitSlop={8} style={styles.moreBtn}>
                <Text variant="small" color={colors.primary} style={{ fontWeight: '600' }}>
                  {t('search.history.clear')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        history.isPending ? (
          <ActivityIndicator style={styles.pad} color={colors.primary} accessibilityLabel={t('common.loading')} />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => history.refetch()} />
        ) : (
          <EmptyState icon="time-outline" title={enabled ? t('search.history.empty') : t('search.history.off')} />
        )
      }
      renderItem={({ item }) => (
        <View style={[styles.histRow, { borderBottomColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.query}, ${t(`search.tab.${item.scope}` as MessageKey)}`}
            onPress={() => onPick(item)}
            style={styles.histMain}
          >
            <Ionicons name="time-outline" size={20} color={colors.textMuted} />
            <View style={styles.flex}>
              <Text numberOfLines={1}>{item.query}</Text>
              {item.scope !== 'all' ? (
                <Text variant="caption" muted>
                  {t(`search.tab.${item.scope}` as MessageKey)}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.history.remove', { q: item.query })}
            onPress={() => remove.mutate(item.id)}
            style={styles.removeBtn}
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: spacing.xl },
  top: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  moreBtn: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: spacing.sm },
  histHead: { gap: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  histRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingLeft: spacing.lg },
  histMain: { flex: 1, minHeight: TOUCH + 4, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  removeBtn: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
});
