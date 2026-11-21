import type { ServiceOfferDetail } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { uuidv4 } from '../../../../../lib/uuid';
import { imageMime, uploadProductImage } from '../../../../../media/upload';
import { getDevicePosition } from '../../../../../places/device-location';
import { GOMA_CENTER, roundCoordinate } from '../../../../../places/geo';
import { minorToDecimalString } from '../../../../../seller/money';
import { Chips, Loading, SectionTitle } from '../../../../../seller/ui';
import { archiveOffer, createOffer, fetchOwnOffer, fetchServiceCategories, svcKeys, updateOffer, type Scope } from '../../../../../services/api';
import { deviceUtcOffset, emptyOfferDraft, MAX_OFFER_PHOTOS, OFFER_CURRENCIES, toOfferBody, validateOffer, type OfferDraft, type OfferErrors } from '../../../../../services/logic';
import { svcErrorMessage } from '../../../../../services/ui';
import { radius, spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { AuthImage, Button, ErrorState, IconButton, Text, TextField } from '../../../../../ui';

interface Photo {
  key: string;
  id?: string;
  contentUrl?: string;
  localUri?: string;
  state: 'uploading' | 'ready' | 'failed';
}

function draftFrom(o: ServiceOfferDetail): OfferDraft {
  return {
    title: o.title,
    description: o.description ?? '',
    categoryId: o.categoryId,
    priceKind: o.priceKind,
    price: o.priceMinor !== null && o.currency ? minorToDecimalString(o.priceMinor, o.currency) : '',
    currency: o.currency ?? 'USD',
    duration: String(o.durationMin),
    cancelNoticeHours: String(o.cancelNoticeHours),
    city: o.city,
    lat: String(o.lat),
    lng: String(o.lng),
    radiusKm: String(o.radiusKm),
    utcOffsetMinutes: o.utcOffsetMinutes,
    urgentAvailable: o.urgentAvailable,
    guaranteeNote: o.guaranteeNote ?? '',
    mediaIds: o.media.map((m) => m.id),
  };
}

/** Éditeur d'offre (`new` pour une création) : charge l'offre puis monte le formulaire. */
export default function OfferEditorRoute() {
  const { t } = useI18n();
  const { scope, id } = useLocalSearchParams<{ scope: string; id: string }>();
  const isNew = id === 'new';
  const offer = useQuery({ queryKey: svcKeys.ownOffer(scope, id), queryFn: () => fetchOwnOffer(scope, id), enabled: !isNew });
  const title = <Stack.Screen options={{ title: isNew ? t('services.pro.offer.new') : t('services.pro.offer.edit') }} />;
  if (!isNew && offer.isPending) return <>{title}<Loading /></>;
  if (!isNew && offer.isError) return <>{title}<ErrorState error={offer.error} onRetry={() => offer.refetch()} /></>;
  return (
    <>
      {title}
      <OfferForm scope={scope} id={isNew ? null : id} initial={isNew ? null : offer.data!} />
    </>
  );
}

function OfferForm({ scope, id, initial }: { scope: Scope; id: string | null; initial: ServiceOfferDetail | null }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const categories = useQuery({ queryKey: svcKeys.categories, queryFn: fetchServiceCategories, staleTime: 10 * 60_000 });
  const [d, setD] = useState<OfferDraft>(() => (initial ? draftFrom(initial) : emptyOfferDraft(deviceUtcOffset())));
  const [photos, setPhotos] = useState<Photo[]>(() =>
    (initial?.media ?? []).map((m) => ({ key: m.id, id: m.id, contentUrl: m.contentUrl, state: 'ready' as const })),
  );
  const [errors, setErrors] = useState<OfferErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pickError, setPickError] = useState(false);
  const [locating, setLocating] = useState(false);
  const needsPosition = scope === 'me';
  const set = (patch: Partial<OfferDraft>) => setD((cur) => ({ ...cur, ...patch }));
  const err = (f: keyof OfferErrors) => (errors[f] ? t(errors[f]!) : null);

  async function pickPhotos() {
    setPickError(false);
    const remaining = MAX_OFFER_PHOTOS - photos.length;
    if (remaining <= 0) return;
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.85 });
      if (res.canceled) return;
      for (const a of res.assets.slice(0, remaining)) {
        const key = uuidv4();
        setPhotos((cur) => [...cur, { key, localUri: a.uri, state: 'uploading' }]);
        uploadProductImage(a.uri, imageMime(a.mimeType, a.uri)).then(
          (assetId) => setPhotos((cur) => cur.map((p) => (p.key === key ? { ...p, id: assetId, state: 'ready' } : p))),
          () => setPhotos((cur) => cur.map((p) => (p.key === key ? { ...p, state: 'failed' } : p))),
        );
      }
    } catch {
      setPickError(true);
    }
  }

  async function useDevicePosition() {
    setLocating(true);
    const r = await getDevicePosition();
    setLocating(false);
    if (r.ok) set({ lat: String(roundCoordinate(r.position.lat)), lng: String(roundCoordinate(r.position.lng)) });
  }

  const save = useMutation({
    mutationFn: async (status: 'draft' | 'published' | undefined) => {
      const body = toOfferBody({ ...d, mediaIds: photos.filter((p) => p.state === 'ready').map((p) => p.id!) }, status, { needsPosition, update: !!id });
      if (!body) throw new Error('invalid');
      return id ? updateOffer(scope, id, body) : createOffer(scope, body);
    },
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: svcKeys.offers(scope) });
      qc.setQueryData(svcKeys.ownOffer(scope, o.id), o);
      router.back();
    },
    onError: (e) => setFormError(e instanceof Error && e.message === 'invalid' ? null : svcErrorMessage(e, t, locale)),
  });
  const archive = useMutation({
    mutationFn: () => archiveOffer(scope, id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: svcKeys.offers(scope) });
      router.back();
    },
    onError: (e) => setFormError(svcErrorMessage(e, t, locale)),
  });

  function submit(status: 'draft' | 'published' | undefined) {
    setFormError(null);
    const e = validateOffer(d, { needsPosition });
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    if (photos.some((p) => p.state === 'uploading')) {
      setFormError(t('services.pro.offer.err.photos'));
      return;
    }
    save.mutate(status);
  }

  const busy = save.isPending || archive.isPending;
  const status = initial?.status;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <TextField label={t('services.pro.offer.name')} value={d.title} onChangeText={(v) => set({ title: v })} maxLength={140} error={err('title')} />
      <TextField label={t('services.pro.offer.description')} value={d.description} onChangeText={(v) => set({ description: v })} multiline maxLength={2000} error={err('description')} />

      <Text variant="bodyStrong">{t('services.pro.offer.category')}</Text>
      <View style={{ marginHorizontal: -spacing.lg }}>
        <Chips options={(categories.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))} value={d.categoryId} onChange={(v) => set({ categoryId: v })} />
      </View>
      {err('categoryId') ? <Text variant="small" color={colors.danger}>{err('categoryId')}</Text> : null}

      <SectionTitle>{t('services.pro.offer.priceKind')}</SectionTitle>
      <Chips
        scroll={false}
        options={[
          { value: 'fixed', label: t('services.pro.offer.fixed') },
          { value: 'quote', label: t('services.pro.offer.quote') },
        ]}
        value={d.priceKind}
        onChange={(v) => set({ priceKind: v })}
      />
      {d.priceKind === 'fixed' ? (
        <>
          <TextField label={t('services.pro.offer.price')} value={d.price} onChangeText={(v) => set({ price: v })} keyboardType="decimal-pad" error={err('price')} />
          <Text variant="bodyStrong">{t('services.pro.offer.currency')}</Text>
          <Chips scroll={false} options={OFFER_CURRENCIES.map((c) => ({ value: c, label: c }))} value={d.currency} onChange={(v) => set({ currency: v })} />
        </>
      ) : null}

      <TextField label={t('services.pro.offer.duration')} value={d.duration} onChangeText={(v) => set({ duration: v })} keyboardType="number-pad" error={err('duration')} />
      <TextField
        label={t('services.pro.offer.cancelNotice')}
        value={d.cancelNoticeHours}
        onChangeText={(v) => set({ cancelNoticeHours: v })}
        keyboardType="number-pad"
        error={err('cancelNoticeHours')}
      />

      <SectionTitle>{t('services.offer.zone')}</SectionTitle>
      <TextField label={t('services.pro.offer.city')} value={d.city} onChangeText={(v) => set({ city: v })} error={err('city')} />
      <TextField label={t('services.pro.offer.radius')} value={d.radiusKm} onChangeText={(v) => set({ radiusKm: v })} keyboardType="number-pad" error={err('radiusKm')} />
      <Text variant="bodyStrong">{t('services.pro.offer.position')}</Text>
      {!needsPosition ? (
        <Text variant="small" muted style={{ marginBottom: spacing.sm }}>
          {t('services.pro.offer.orgPosition')}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button variant="secondary" label={t('services.pro.offer.useDevice')} loading={locating} onPress={useDevicePosition} style={{ flex: 1 }} />
        <Button
          variant="secondary"
          label={t('services.pro.offer.useGoma')}
          onPress={() => set({ lat: String(GOMA_CENTER.lat), lng: String(GOMA_CENTER.lng) })}
          style={{ flex: 1 }}
        />
      </View>
      <View style={[styles.row, { marginTop: spacing.md }]}>
        <View style={{ flex: 1 }}>
          <TextField label={t('services.pro.offer.lat')} value={d.lat} onChangeText={(v) => set({ lat: v })} keyboardType="numbers-and-punctuation" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label={t('services.pro.offer.lng')} value={d.lng} onChangeText={(v) => set({ lng: v })} keyboardType="numbers-and-punctuation" />
        </View>
      </View>
      {err('position') ? <Text variant="small" color={colors.danger} style={{ marginBottom: spacing.md }}>{err('position')}</Text> : null}

      <SectionTitle>{t('services.pro.offer.photos')}</SectionTitle>
      <Text variant="small" muted style={{ marginBottom: spacing.sm }}>
        {t('services.pro.offer.photosHint')}
      </Text>
      <View style={styles.photoGrid}>
        {photos.map((p, i) => (
          <View key={p.key} style={styles.photoCell}>
            <View style={[styles.photo, { backgroundColor: colors.surfaceAlt, borderColor: p.state === 'failed' ? colors.danger : 'transparent' }]}>
              <AuthImage contentUrl={p.contentUrl ?? null} localUri={p.localUri} label={t('services.offer.photo', { n: i + 1 })} style={StyleSheet.absoluteFill} />
              {p.state !== 'ready' ? (
                <View style={[StyleSheet.absoluteFill, styles.photoState, { backgroundColor: colors.overlay }]}>
                  <Text variant="caption" color="#FFFFFF">
                    {p.state === 'uploading' ? t('services.pro.offer.photoUploading') : t('services.pro.offer.photoFailed')}
                  </Text>
                </View>
              ) : null}
            </View>
            <IconButton icon="close-circle-outline" size={22} color={colors.danger} label={t('services.pro.offer.photoRemove')} onPress={() => setPhotos((c) => c.filter((x) => x.key !== p.key))} />
          </View>
        ))}
      </View>
      {pickError ? <Text variant="small" color={colors.danger}>{t('compose.pickError')}</Text> : null}
      <Button variant="secondary" label={t('services.pro.offer.addPhoto')} disabled={photos.length >= MAX_OFFER_PHOTOS} onPress={pickPhotos} style={{ marginBottom: spacing.md }} />

      <View style={[styles.switchRow]}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{t('services.pro.offer.urgent')}</Text>
          <Text variant="small" muted>
            {t('services.pro.offer.urgentHint')}
          </Text>
        </View>
        <Switch accessibilityRole="switch" accessibilityState={{ checked: d.urgentAvailable }} value={d.urgentAvailable} onValueChange={(v) => set({ urgentAvailable: v })} accessibilityLabel={t('services.pro.offer.urgent')} />
      </View>
      <TextField
        label={t('services.pro.offer.guarantee')}
        hint={t('services.pro.offer.guaranteeHint')}
        value={d.guaranteeNote}
        onChangeText={(v) => set({ guaranteeNote: v })}
        maxLength={200}
        error={err('guaranteeNote')}
      />

      {formError ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>
          {formError}
        </Text>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        {status === 'published' ? (
          <Button label={t('services.pro.offer.save')} loading={save.isPending} disabled={busy} onPress={() => submit(undefined)} />
        ) : (
          <>
            <Button label={t('services.pro.offer.publish')} loading={save.isPending && save.variables === 'published'} disabled={busy} onPress={() => submit('published')} />
            <Button variant="secondary" label={t('services.pro.offer.saveDraft')} loading={save.isPending && save.variables === 'draft'} disabled={busy} onPress={() => submit(status ? undefined : 'draft')} />
          </>
        )}
        {id ? (
          <>
            <Button
              variant="secondary"
              label={t('services.pro.availability')}
              onPress={() => router.push({ pathname: '/provider/[scope]/availability', params: { scope, offerId: id } })}
            />
            <Button variant="secondary" label={t('services.pro.reviews')} onPress={() => router.push({ pathname: '/provider/[scope]/reviews', params: { scope, offerId: id } })} />
            {status !== 'archived' ? <Button variant="danger" label={t('services.pro.offer.archive')} loading={archive.isPending} disabled={busy} onPress={() => archive.mutate()} /> : null}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  photoCell: { width: 96, alignItems: 'center' },
  photo: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2 },
  photoState: { alignItems: 'center', justifyContent: 'center' },
});
