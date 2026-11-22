import type { CreateListingRequest, ListingKind } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { createListing, listingKeys } from '../../../listings/api';
import { hasPrice, kindKey, LISTING_KINDS } from '../../../listings/logic';
import { imageMime, uploadImage } from '../../../media/upload';
import { Chips } from '../../../seller/ui';
import { parseWalletAmount, WALLET_CURRENCIES } from '../../../wallet/amount';
import { radius, spacing } from '../../../theme/tokens';
import { Button, Screen, Text, TextField } from '../../../ui';
import { useTheme } from '../../../theme/use-theme';

const MAX_PHOTOS = 8;
const FUELS = ['petrol', 'diesel', 'hybrid', 'electric', 'other'] as const;
const TRANSMISSIONS = ['manual', 'automatic'] as const;

/** Publier une annonce : catégorie, titre, description, prix (sauf perdu/trouvé), ville, photos. */
export default function NewListing() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [kind, setKind] = useState<ListingKind>('property_rent');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [city, setCity] = useState('Goma');
  const [vehicle, setVehicle] = useState({ make: '', model: '', year: '', mileage: '', fuel: '', transmission: '' });
  const setV = (k: keyof typeof vehicle) => (v: string) => setVehicle((cur) => ({ ...cur, [k]: v }));
  const [photos, setPhotos] = useState<{ uri: string; mime: string | null | undefined }[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setError(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS - photos.length,
        quality: 0.8,
      });
      if (!res.canceled) setPhotos((cur) => [...cur, ...res.assets.map((a) => ({ uri: a.uri, mime: a.mimeType }))].slice(0, MAX_PHOTOS));
    } catch {
      setError(t('listings.err.photos'));
    }
  }

  const publish = useMutation({
    mutationFn: async () => {
      let priceMinor: number | null = null;
      if (hasPrice(kind) && price.trim()) {
        const p = parseWalletAmount(price, currency);
        if ('issue' in p) throw new Error('invalid_price');
        priceMinor = p.minor;
      }
      let mediaIds: string[];
      try {
        mediaIds = await Promise.all(photos.map((p) => uploadImage(p.uri, imageMime(p.mime, p.uri), 'listing')));
      } catch {
        throw new Error('photos');
      }
      const num = (s: string): number | null => {
        if (!s.trim()) return null;
        const n = Number(s.trim());
        if (!Number.isInteger(n)) throw new Error('invalid_price');
        return n;
      };
      const isVehicle = kind === 'vehicle';
      return createListing({
        make: isVehicle ? vehicle.make.trim() || null : null,
        model: isVehicle ? vehicle.model.trim() || null : null,
        year: isVehicle ? num(vehicle.year) : null,
        mileageKm: isVehicle ? num(vehicle.mileage) : null,
        fuel: isVehicle ? ((vehicle.fuel || null) as CreateListingRequest['fuel']) : null,
        transmission: isVehicle ? ((vehicle.transmission || null) as CreateListingRequest['transmission']) : null,
        kind,
        title: title.trim(),
        description: description.trim(),
        priceMinor,
        currency: priceMinor === null ? null : currency,
        city: city.trim(),
        latitude: null,
        longitude: null,
        mediaIds,
      });
    },
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: listingKeys.all });
      router.replace({ pathname: '/listings/[id]', params: { id: l.id } });
    },
    onError: (e) => {
      if (e instanceof Error && e.message === 'invalid_price') return setError(t('listings.err.invalid'));
      if (e instanceof Error && e.message === 'photos') return setError(t('listings.err.photos'));
      if (e instanceof ApiRequestError && e.detail<string>('reason') === 'listing_limit') return setError(t('listings.err.limit'));
      setError(e instanceof ApiRequestError && e.status === 400 ? t('listings.err.invalid') : errorMessage(e, t, locale));
    },
  });

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('listings.new') }} />
      <View style={styles.form}>
        <Text variant="bodyStrong">{t('listings.field.kind')}</Text>
        <Chips flush options={LISTING_KINDS.map((k) => ({ value: k, label: t(kindKey(k)) }))} value={kind} onChange={setKind} />
        <TextField label={t('listings.field.title')} value={title} onChangeText={setTitle} maxLength={120} />
        <TextField label={t('listings.field.description')} value={description} onChangeText={setDescription} multiline maxLength={2000} />
        {hasPrice(kind) ? (
          <>
            <TextField label={t('listings.field.price')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
            <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} scroll={false} />
          </>
        ) : null}
        {kind === 'vehicle' ? (
          <>
            <TextField label={t('listings.vehicle.make')} value={vehicle.make} onChangeText={setV('make')} maxLength={40} />
            <TextField label={t('listings.vehicle.model')} value={vehicle.model} onChangeText={setV('model')} maxLength={40} />
            <TextField label={t('listings.vehicle.year')} value={vehicle.year} onChangeText={setV('year')} keyboardType="number-pad" maxLength={4} />
            <TextField label={t('listings.vehicle.mileage')} value={vehicle.mileage} onChangeText={setV('mileage')} keyboardType="number-pad" maxLength={7} />
            <Text variant="bodyStrong">{t('listings.vehicle.fuel')}</Text>
            <Chips options={[{ value: '', label: '-' }, ...FUELS.map((f) => ({ value: f, label: t(`listings.vehicle.fuel.${f}` as MessageKey) }))]} value={vehicle.fuel} onChange={setV('fuel')} />
            <Text variant="bodyStrong">{t('listings.vehicle.transmission')}</Text>
            <Chips options={[{ value: '', label: '-' }, ...TRANSMISSIONS.map((f) => ({ value: f, label: t(`listings.vehicle.transmission.${f}` as MessageKey) }))]} value={vehicle.transmission} onChange={setV('transmission')} />
          </>
        ) : null}
        <TextField label={t('listings.field.city')} value={city} onChangeText={setCity} maxLength={80} />
        <View style={styles.thumbs}>
          {photos.map((p) => (
            <Image key={p.uri} source={{ uri: p.uri }} style={[styles.thumb, { backgroundColor: colors.surface }]} accessibilityIgnoresInvertColors />
          ))}
        </View>
        {photos.length < MAX_PHOTOS ? <Button variant="secondary" label={t('listings.photos', { n: photos.length })} onPress={pick} /> : null}
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('listings.publish')} loading={publish.isPending} disabled={title.trim().length < 3 || city.trim().length < 2} onPress={() => publish.mutate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
});
