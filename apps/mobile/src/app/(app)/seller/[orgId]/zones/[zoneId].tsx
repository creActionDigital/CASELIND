import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { createZone, deliveryKeys, fetchZones, patchZone } from '../../../../../delivery/api';
import { deliveryErrorMessage } from '../../../../../delivery/errors';
import { emptyZoneDraft, toZoneRequest, validateZone, zoneToDraft, type ZoneDraft, type ZoneErrors } from '../../../../../delivery/zone-form';
import { useI18n } from '../../../../../i18n';
import { SELLER_CURRENCIES } from '../../../../../seller/money';
import { Loading } from '../../../../../seller/ui';
import { useTheme } from '../../../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../../../ui';

/** Création (`zoneId` = `new`) ou modification d'une zone de livraison. */
export default function SellerZoneForm() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId, zoneId } = useLocalSearchParams<{ orgId: string; zoneId: string }>();
  const isNew = zoneId === 'new';
  const zones = useQuery({ queryKey: deliveryKeys.zones(orgId), queryFn: () => fetchZones(orgId), enabled: !isNew });
  const [draft, setDraft] = useState<ZoneDraft>(emptyZoneDraft());
  const [loaded, setLoaded] = useState(isNew);
  const [errors, setErrors] = useState<ZoneErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded || !zones.data) return;
    const z = zones.data.items.find((x) => x.id === zoneId);
    if (z) setDraft(zoneToDraft(z));
    setLoaded(true);
  }, [zones.data, zoneId, loaded]);

  const save = useMutation({
    mutationFn: () => (isNew ? createZone(orgId, toZoneRequest(draft)) : patchZone(orgId, zoneId, toZoneRequest(draft))),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deliveryKeys.zones(orgId) });
      void qc.invalidateQueries({ queryKey: deliveryKeys.publicZones(orgId) });
      router.back();
    },
    onError: (e) => setFormError(deliveryErrorMessage(e, t, locale)),
  });

  if (!isNew && zones.isPending) return <Loading />;
  if (!isNew && zones.isError) return <ErrorState error={zones.error} onRetry={() => zones.refetch()} />;

  function submit() {
    setFormError(null);
    const e = validateZone(draft);
    setErrors(e);
    if (Object.keys(e).length === 0) save.mutate();
  }
  const bad = (k: keyof ZoneErrors) => (errors[k] ? t('delivery.zones.invalid') : undefined);

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? t('delivery.zones.new') : t('delivery.zones.edit') }} />
      <TextField label={t('delivery.zones.name')} value={draft.name} onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))} error={bad('name')} maxLength={80} />
      <TextField
        label={t('delivery.zones.areas')}
        hint={t('delivery.zones.areasHint')}
        value={draft.areas}
        onChangeText={(v) => setDraft((d) => ({ ...d, areas: v }))}
        error={bad('areas')}
        multiline
      />
      <Text variant="small" style={{ fontWeight: '600' }}>
        {t('delivery.zones.fees')}
      </Text>
      {SELLER_CURRENCIES.map((c) => (
        <TextField
          key={c}
          label={`${t('delivery.fee')} (${c})`}
          hint={t('delivery.zones.feeHint')}
          value={draft.fees[c] ?? ''}
          onChangeText={(v) => setDraft((d) => ({ ...d, fees: { ...d.fees, [c]: v } }))}
          error={errors.fees ? t('delivery.zones.feesInvalid') : undefined}
          keyboardType="decimal-pad"
        />
      ))}
      <TextField
        label={t('delivery.zones.eta')}
        value={draft.eta}
        onChangeText={(v) => setDraft((d) => ({ ...d, eta: v }))}
        error={bad('eta')}
        keyboardType="number-pad"
        maxLength={5}
      />
      {formError ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {formError}
        </Text>
      ) : null}
      <Button label={t('common.save')} loading={save.isPending} onPress={submit} />
    </Screen>
  );
}
