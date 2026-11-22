import type { CreateFavoritePlaceRequest } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { addFavorite, deleteFavorite, fetchFavorites, rideKeys } from '../../../mobility/api';
import { mobilityErrorMessage } from '../../../mobility/errors';
import { isFavoriteLimitReached } from '../../../mobility/logic';
import { PlacePicker } from '../../../places/PlacePicker';
import { Card, Chips, Loading, SectionTitle } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Screen, Text, TextField } from '../../../ui';

type Kind = CreateFavoritePlaceRequest['kind'];

/** Lieux favoris : 5 au plus, un seul domicile et un seul travail. */
export default function FavoritePlaces() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: rideKeys.favorites, queryFn: fetchFavorites, retry: false });
  const [kind, setKind] = useState<Kind>('home');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (body: CreateFavoritePlaceRequest) => addFavorite(body),
    onMutate: () => setError(null),
    onSuccess: () => {
      setName('');
      setAddress('');
      setPoint(null);
      void qc.invalidateQueries({ queryKey: rideKeys.favorites });
    },
    onError: (e) => setError(mobilityErrorMessage(e, t, locale)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFavorite(id),
    onMutate: () => setError(null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: rideKeys.favorites }),
    onError: (e) => setError(mobilityErrorMessage(e, t, locale)),
  });

  function submit() {
    if (!name.trim() || !point || !address.trim()) return setError(t('mobility.places.invalid'));
    add.mutate({ kind, label: name.trim().slice(0, 60), address: address.trim().slice(0, 160), lat: point.lat, lng: point.lng });
  }

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.items;
  const full = isFavoriteLimitReached(items.length);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mobility.places.title') }} />
      <Text muted>{t('mobility.places.intro')}</Text>
      {items.length === 0 ? (
        <EmptyState icon="location-outline" title={t('mobility.places.emptyTitle')} body={t('mobility.places.emptyBody')} />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {items.map((f) => (
            <Card key={f.id} style={{ gap: spacing.xs }}>
              <Text variant="bodyStrong">
                {f.label} · {t(`mobility.places.kind.${f.kind}` as MessageKey)}
              </Text>
              <Text variant="small" muted>
                {f.address}
              </Text>
              <Button
                variant="ghost"
                label={t('mobility.places.delete')}
                accessibilityLabel={t('mobility.places.deleteLabel', { name: f.label })}
                loading={remove.isPending && remove.variables === f.id}
                onPress={() => remove.mutate(f.id)}
              />
            </Card>
          ))}
        </View>
      )}

      {!full ? (
        <>
          <SectionTitle>{t('mobility.places.add')}</SectionTitle>
          <Chips<Kind> flush
            scroll={false}
            options={(['home', 'work', 'other'] as const).map((k) => ({ value: k, label: t(`mobility.places.kind.${k}` as MessageKey) }))}
            value={kind}
            onChange={setKind}
          />
          <TextField label={t('mobility.places.name')} value={name} onChangeText={setName} maxLength={60} />
          <TextField label={t('mobility.places.address')} value={address} onChangeText={setAddress} maxLength={160} />
          <Button variant="secondary" label={point ? t('mobility.place.chosen', { label: point.label }) : t('mobility.place.pick')} onPress={() => setPicking(true)} />
          <PlacePicker
            visible={picking}
            onClose={() => setPicking(false)}
            onPick={(p) => {
              setPicking(false);
              setPoint(p as { lat: number; lng: number; label: string });
              if (!address.trim()) setAddress(p.label ?? '');
            }}
          />
          {error ? (
            <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label={t('mobility.places.save')} loading={add.isPending} onPress={submit} />
        </>
      ) : error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
