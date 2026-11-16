import type { ListingVisit } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { answerVisit, fetchVisits, listingKeys } from '../../../listings/api';
import { visitErrorKey } from '../../../listings/logic';
import { brandColor, radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Mes visites : demandes envoyées et reçues ; le propriétaire confirme (avec un lieu précis facultatif) ou refuse, chacun peut annuler. */
export default function Visits() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: listingKeys.visits, queryFn: fetchVisits });
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (a: { v: ListingVisit; action: 'confirm' | 'decline' | 'cancel' }) =>
      answerVisit(a.v.id, a.action, a.action === 'confirm' && places[a.v.id]?.trim() ? { place: places[a.v.id]!.trim() } : {}),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: listingKeys.visits });
    },
    onError: (e) => {
      const key = e instanceof ApiRequestError ? visitErrorKey(e.details) : null;
      setError(key ? t(key) : errorMessage(e, t, locale));
    },
  });

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
  const busy = (v: ListingVisit, action: string) => act.isPending && act.variables?.v.id === v.id && act.variables.action === action;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('listings.visit.mine') }} />
      <View style={styles.list}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text variant="small" muted>
            {t('listings.visit.safety')}
          </Text>
        </View>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {list.data.items.length === 0 ? <Text muted>{t('listings.visit.empty')}</Text> : null}
        {list.data.items.map((v) => (
          <View key={v.id} style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="heading">{v.listingTitle}</Text>
            <Text muted>{t(v.role === 'owner' ? 'listings.visit.receivedFrom' : 'listings.visit.sentBy', { name: v.other.displayName })}</Text>
            <Text>{new Date(v.scheduledAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</Text>
            <Badge tone={v.status === 'confirmed' ? 'primary' : 'neutral'} label={t(`listings.visit.status.${v.status}` as 'listings.visit.status.requested')} />
            {v.message ? <Text>{v.message}</Text> : null}
            {v.place ? <Text style={{ color: brandColor }}>{t('listings.visit.place', { place: v.place })}</Text> : null}
            {v.role === 'owner' && v.status === 'requested' ? (
              <>
                <TextField label={t('listings.visit.placeField')} value={places[v.id] ?? ''} onChangeText={(x) => setPlaces({ ...places, [v.id]: x })} maxLength={200} />
                <Button label={t('listings.visit.confirm')} loading={busy(v, 'confirm')} onPress={() => act.mutate({ v, action: 'confirm' })} />
                <Button variant="secondary" label={t('listings.visit.decline')} loading={busy(v, 'decline')} onPress={() => act.mutate({ v, action: 'decline' })} />
              </>
            ) : null}
            {v.status === 'requested' || v.status === 'confirmed' ? (
              <Button variant="ghost" label={t('listings.visit.cancel')} loading={busy(v, 'cancel')} onPress={() => act.mutate({ v, action: 'cancel' })} />
            ) : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { borderRadius: radius.md, gap: spacing.sm, padding: spacing.md },
});
