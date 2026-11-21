import type { OrgKind, RidePoint } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useI18n, type MessageKey } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { PlaceRow } from '../../../mobility/extra/ui';
import { PlaceSheet } from '../../../mobility/ui';
import { setOrgLocation } from '../../../places/api';
import { createOrg, sk } from '../../../seller/api';
import { normalizePhone, slugify, validateShop } from '../../../seller/shop-form';
import { Chips, sellerErrorMessage } from '../../../seller/ui';
import { useTheme } from '../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../ui';

const KINDS: OrgKind[] = ['restaurant', 'hotel', 'pharmacy', 'hospital', 'school', 'services', 'shop', 'fuel_station', 'other'];

/** Ajouter un établissement : création de l'organisation (je deviens propriétaire) puis pose de sa position sur la carte. */
export default function AddPlace() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<OrgKind>('restaurant');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [point, setPoint] = useState<RidePoint | null>(null);
  const [picking, setPicking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = validateShop({ name, slug: slugify(name), phone });
  const create = useMutation({
    mutationFn: async () => {
      let slug = slugify(name);
      // Un nom déjà pris : on retente avec un suffixe plutôt que d'imposer un identifiant technique.
      for (let i = 0; ; i += 1) {
        try {
          const org = await createOrg({ slug: i === 0 ? slug : `${slug.slice(0, 34)}-${Math.floor(Math.random() * 9000 + 1000)}`, name: name.trim(), kind, city: city.trim() || undefined, phone: normalizePhone(phone) });
          await setOrgLocation(org.id, { lat: point!.lat, lng: point!.lng, label: point!.label?.slice(0, 120) || undefined });
          return org;
        } catch (e) {
          if (!(e instanceof ApiRequestError && e.status === 409 && i < 3)) throw e;
        }
      }
    },
    onSuccess: (org) => {
      void qc.invalidateQueries({ queryKey: sk.myOrgs });
      void qc.invalidateQueries({ queryKey: ['places'] });
      router.replace({ pathname: '/seller/[orgId]', params: { orgId: org.id } });
    },
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
  });

  function submit() {
    setSubmitted(true);
    setError(null);
    if (errors.name || errors.phone || !point) return;
    create.mutate();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mb.add.title') }} />
      <Text muted>{t('mb.add.intro')}</Text>
      <TextField label={t('seller.form.name')} value={name} onChangeText={setName} maxLength={120} error={submitted && errors.name ? t('seller.form.nameRequired') : null} />
      <Chips scroll={false} options={KINDS.map((k) => ({ value: k, label: t(`seller.kind.${k}` as MessageKey) }))} value={kind} onChange={setKind} />
      <TextField label={t('seller.form.city')} value={city} onChangeText={setCity} maxLength={120} />
      <TextField label={t('seller.form.phone')} hint={t('seller.form.phoneHint')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={submitted && errors.phone ? t('seller.form.phoneInvalid') : null} />
      <PlaceRow label={t('mb.add.position')} point={point} icon="radio-button-on" onPress={() => setPicking(true)} />
      {submitted && !point ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {t('mb.add.positionRequired')}
        </Text>
      ) : null}
      {error ? (
        <Text color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={t('mb.add.submit')} loading={create.isPending} onPress={submit} />
      <PlaceSheet
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          setPoint(p);
          setPicking(false);
        }}
      />
    </Screen>
  );
}
