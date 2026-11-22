import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { fetchOrgLocation, removeOrgLocation, setOrgLocation, updateOrgLocation } from '../../../../places/api';
import { getDevicePosition } from '../../../../places/device-location';
import { GOMA_CENTER, parseCoordinate, roundCoordinate } from '../../../../places/geo';
import { TileMap } from '../../../../places/TileMap';
import { useMembership } from '../../../../seller/api';
import { canEditProfile } from '../../../../seller/permissions';
import { Loading, sellerErrorMessage } from '../../../../seller/ui';
import { radius, spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../ui';

/** Emplacement public de la boutique (permission `org.profile.edit`) : position actuelle ou saisie, libellé, retrait. */
export default function SellerLocation() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [label, setLabel] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [locating, setLocating] = useState(false);
  const [info, setInfo] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [fitTick, setFitTick] = useState(0); // recadre la carte à la lecture de l'existant et à « position actuelle », pas à chaque appui

  const current = useQuery({ queryKey: ['org-location', orgId], queryFn: () => fetchOrgLocation(orgId), enabled: !!orgId });
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (prefilled || !current.isSuccess) return;
    setPrefilled(true);
    if (current.data) {
      setFitTick((n) => n + 1);
      setLat(String(current.data.lat));
      setLng(String(current.data.lng));
      setLabel(current.data.label ?? '');
    }
  }, [current.isSuccess, current.data, prefilled]);

  const latN = parseCoordinate(lat, 'lat');
  const lngN = parseCoordinate(lng, 'lng');
  const valid = latN !== null && lngN !== null;

  const save = useMutation({
    mutationFn: async () => {
      const body = { lat: latN as number, lng: lngN as number };
      const lab = label.trim();
      try {
        await setOrgLocation(orgId, lab ? { ...body, label: lab } : body);
      } catch (e) {
        // Déjà localisée : on met à jour l'emplacement existant.
        if (e instanceof ApiRequestError && e.status === 409) await updateOrgLocation(orgId, { ...body, label: lab || null });
        else throw e;
      }
    },
    onSuccess: () => setInfo({ text: t('seller.location.saved'), tone: 'ok' }),
    onError: (e) => setInfo({ text: sellerErrorMessage(e, t, locale), tone: 'error' }),
  });
  const remove = useMutation({
    mutationFn: () => removeOrgLocation(orgId),
    onSuccess: () => {
      setLat('');
      setLng('');
      setLabel('');
      setInfo({ text: t('seller.location.removed'), tone: 'ok' });
    },
    onError: (e) => setInfo({ text: sellerErrorMessage(e, t, locale), tone: 'error' }),
  });

  const title = <Stack.Screen options={{ title: t('seller.location.title') }} />;
  if (isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (!canEditProfile(role)) {
    return (
      <>
        {title}
        <Screen>
          <Text muted>{t('seller.location.forbidden')}</Text>
        </Screen>
      </>
    );
  }

  const useCurrent = async () => {
    setLocating(true);
    setInfo(null);
    const r = await getDevicePosition();
    setLocating(false);
    if (r.ok) {
      setLat(String(roundCoordinate(r.position.lat)));
      setLng(String(roundCoordinate(r.position.lng)));
      setFitTick((n) => n + 1);
    } else {
      setInfo({ text: t(r.reason === 'denied' ? 'seller.location.denied' : 'places.unavailable'), tone: 'error' });
    }
  };

  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <Text muted style={{ marginBottom: spacing.lg }}>
          {t('seller.location.intro')}
        </Text>
        <Button label={locating ? t('places.locating') : t('seller.location.current')} variant="secondary" loading={locating} onPress={useCurrent} style={{ marginBottom: spacing.lg }} />
        <TileMap
          style={{ height: 240, borderRadius: radius.lg, marginBottom: spacing.sm }}
          fit={valid ? [{ lat: latN, lng: lngN }] : [GOMA_CENTER]}
          fitKey={`loc-${fitTick}`}
          markers={valid ? [{ id: 'shop', lat: latN, lng: lngN, label: label.trim() || t('seller.location.title'), selected: true }] : []}
          onPick={(p) => {
            setLat(String(roundCoordinate(p.lat)));
            setLng(String(roundCoordinate(p.lng)));
          }}
        />
        <Text variant="small" muted style={{ marginBottom: spacing.lg }}>
          {t('places.pickHint')}
        </Text>
        {submitted && !valid ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>
            {t('seller.location.invalid')}
          </Text>
        ) : null}
        <TextField label={t('seller.location.label')} hint={t('seller.location.labelHint')} value={label} onChangeText={setLabel} maxLength={120} />
        {info ? (
          <Text color={info.tone === 'ok' ? colors.success : colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>
            {info.text}
          </Text>
        ) : null}
        <View style={{ gap: spacing.sm }}>
          <Button
            label={t('seller.location.save')}
            loading={save.isPending}
            disabled={remove.isPending}
            onPress={() => {
              setSubmitted(true);
              setInfo(null);
              if (valid) save.mutate();
            }}
          />
          <Button
            label={t('seller.location.remove')}
            variant="danger"
            loading={remove.isPending}
            disabled={save.isPending}
            onPress={() => {
              setInfo(null);
              remove.mutate();
            }}
          />
        </View>
      </Screen>
    </>
  );
}
