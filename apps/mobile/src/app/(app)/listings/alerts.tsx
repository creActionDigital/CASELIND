import type { ListingKind } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { createListingAlert, deleteListingAlert, fetchListingAlerts, listingKeys } from '../../../listings/api';
import { kindKey } from '../../../listings/logic';
import { Chips } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

const KINDS: ListingKind[] = ['property_rent', 'property_sale', 'roommate', 'vehicle', 'used_item', 'lost', 'found'];

/** Alertes d'annonces : privées, 5 au plus ; une notification quand une nouvelle annonce correspond. */
export default function ListingAlerts() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: listingKeys.alerts, queryFn: fetchListingAlerts });
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [kind, setKind] = useState<ListingKind | ''>('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: listingKeys.alerts });

  const add = useMutation({
    mutationFn: () => createListingAlert({ q: q.trim() || undefined, city: city.trim() || undefined, kind: kind || undefined }),
    onSuccess: () => {
      setError(null);
      setQ('');
      setCity('');
      setKind('');
      void refresh();
    },
    onError: (e) => setError(e instanceof ApiRequestError && e.status === 409 ? t('listings.alerts.limit') : errorMessage(e, t, locale)),
  });
  const remove = useMutation({ mutationFn: deleteListingAlert, onSuccess: () => void refresh(), onError: (e) => setError(errorMessage(e, t, locale)) });

  if (list.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (list.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      </Screen>
    );
  }
  const empty = !q.trim() && !city.trim() && !kind;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('listings.alerts') }} />
      <View style={styles.form}>
        <View style={[styles.note, { backgroundColor: colors.surface }]}>
          <Text variant="small" muted>
            {t('listings.alerts.intro')}
          </Text>
        </View>
        {list.data.items.length === 0 ? <Text muted>{t('listings.alerts.empty')}</Text> : null}
        {list.data.items.map((a) => (
          <View key={a.id} style={[styles.row, { backgroundColor: colors.surface }]}>
            <Text style={styles.flex}>{[a.q, a.city, a.kind ? t(kindKey(a.kind)) : null].filter(Boolean).join(' · ')}</Text>
            <Button variant="danger" label={t('listings.alerts.delete')} loading={remove.isPending && remove.variables === a.id} onPress={() => remove.mutate(a.id)} />
          </View>
        ))}
        <TextField label={t('listings.alerts.q')} value={q} onChangeText={setQ} maxLength={100} autoCapitalize="none" />
        <TextField label={t('listings.alerts.city')} value={city} onChangeText={setCity} maxLength={80} />
        <Chips flush
          options={[{ value: '' as const, label: t('listings.all') }, ...KINDS.map((c) => ({ value: c, label: t(kindKey(c)) }))]}
          value={kind}
          onChange={(v) => setKind(v === kind ? '' : v)}
        />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('listings.alerts.add')} loading={add.isPending} disabled={empty} onPress={() => add.mutate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  note: { borderRadius: radius.md, padding: spacing.md },
  row: { alignItems: 'center', borderRadius: radius.md, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
});
