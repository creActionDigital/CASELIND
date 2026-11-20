import type { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View, type ListRenderItem } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n, type MessageKey } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { alertConfirm } from '../lib/confirm';
import { errorMessage } from '../lib/errors';
import { PagedList } from '../seller/ui';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, EmptyState, Text, TextField } from '../ui';
import type { PlatformRole } from './console-logic';

export const isDenied = (e: unknown): boolean => e instanceof ApiRequestError && e.status === 403;

/** Message d'erreur d'une action d'administration : 403, puis `details.reason` connu (adm.err.*), puis le code HTTP. */
export function adminErrorMessage(e: unknown, t: (k: MessageKey, p?: Record<string, string | number>) => string, locale: string): string {
  if (isDenied(e)) return t('adm.denied');
  const why = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
  const key = `adm.err.${why}` as MessageKey;
  return why && t(key) !== key ? t(key) : errorMessage(e, t, locale);
}

export function useHasRole(roles: readonly PlatformRole[]): boolean {
  const { me } = useAuth();
  return roles.some((r) => me?.roles.includes(r));
}

export function Denied() {
  const { t } = useI18n();
  return <EmptyState icon="lock-closed-outline" title={t('adm.denied')} />;
}

type Page<T> = { items: T[]; nextCursor: string | null };

/** Liste à curseur : `fetcher(cursor)` renvoie une page ; `key` doit contenir tous les filtres. */
export function useCursorList<T>(key: readonly (string | number)[], fetcher: (cursor?: string) => Promise<Page<T>>, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['admin-console', ...key],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetcher(pageParam),
    getNextPageParam: (l: Page<T>) => l.nextCursor ?? undefined,
    enabled,
  });
}

type ListProps<T> = {
  title: string;
  query: UseInfiniteQueryResult<InfiniteData<Page<T>>>;
  keyExtractor: (item: T) => string;
  renderItem: ListRenderItem<T>;
  header?: ReactNode;
  emptyTitle: string;
  emptyIcon?: ComponentProps<typeof Ionicons>['name'];
};

/** Écran de liste d'administration : accès refusé sur 403, sinon chargement / erreur / vide / pages / actualisation. */
export function AdminList<T>({ title, query, keyExtractor, renderItem, header, emptyTitle, emptyIcon = 'checkmark-circle-outline' }: ListProps<T>) {
  const { colors } = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title }} />
      {isDenied(query.error) ? (
        <>
          {header}
          <Denied />
        </>
      ) : (
        <PagedList query={query} keyExtractor={keyExtractor} renderItem={renderItem} header={header} empty={{ icon: emptyIcon, title: emptyTitle }} />
      )}
    </View>
  );
}

/**
 * Décision sur un élément : choix de l'action, motif (obligatoire selon `needsReason`), puis confirmation
 * (alertConfirm : fonctionne aussi sur le web). Le serveur reste la référence ; ses erreurs s'affichent ici.
 */
export function DecisionPanel<D extends string>({
  name,
  decisions,
  run,
  fieldLabel,
  needsReason,
  labelOf,
}: {
  name: string;
  decisions: D[];
  run: (d: D, reason: string) => Promise<unknown>;
  /** Libellé du champ de saisie (motif ou note). */
  fieldLabel?: MessageKey;
  needsReason: (d: D) => boolean;
  labelOf: (d: D) => string;
}) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const [open, setOpen] = useState<D | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = labelOf;
  if (decisions.length === 0) return null;

  const submit = (d: D) => {
    const go = () => {
      setBusy(true);
      setError(null);
      run(d, reason.trim()).then(
        () => { setOpen(null); setReason(''); setBusy(false); },
        (e: unknown) => { setError(adminErrorMessage(e, t, locale)); setBusy(false); },
      );
    };
    alertConfirm(t('adm.confirmTitle'), t('adm.confirmBody', { action: label(d), name }), [
      { text: t('adm.cancel'), style: 'cancel' },
      { text: label(d), onPress: go },
    ]);
  };

  if (!open) {
    return (
      <View style={styles.row}>
        {decisions.map((d) => (
          <Button key={d} variant={d === 'reject' || d === 'suspend' ? 'secondary' : 'primary'} label={label(d)} onPress={() => { setOpen(d); setReason(''); setError(null); }} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.col}>
      <TextField label={t(fieldLabel ?? (needsReason(open) ? 'adm.reason' : 'adm.reasonOptional'))} value={reason} onChangeText={setReason} multiline maxLength={500} />
      {error ? <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button variant={open === 'reject' || open === 'suspend' ? 'danger' : 'primary'} label={label(open)} loading={busy} disabled={needsReason(open) && reason.trim().length < 3} onPress={() => submit(open)} />
      <Button variant="ghost" label={t('adm.cancel')} onPress={() => { setOpen(null); setError(null); }} />
    </View>
  );
}

export const when = (iso: string, locale: string): string => new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

export const adminStyles = StyleSheet.create({
  card: { marginHorizontal: spacing.md, gap: spacing.xs },
  /** Carte dans un écran à défilement simple (déjà rembourré). */
  cardFlat: { gap: spacing.xs, marginBottom: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  filters: { paddingBottom: spacing.xs },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  col: { gap: spacing.sm, marginTop: spacing.xs },
});
