import type { OrgKind } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ApiRequestError } from '../../../lib/api';
import { useI18n, type MessageKey } from '../../../i18n';
import { createOrg, sk } from '../../../seller/api';
import { normalizePhone, slugify, validateShop } from '../../../seller/shop-form';
import { Chips, sellerErrorMessage } from '../../../seller/ui';
import { useTheme } from '../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../ui';

const KINDS: OrgKind[] = ['shop', 'restaurant', 'pharmacy', 'services', 'hotel', 'warehouse', 'school', 'hospital', 'other'];

/** Créer ma boutique : formulaire court (POST /v1/orgs). */
export default function NewShop() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [kind, setKind] = useState<OrgKind>('shop');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [slugTaken, setSlugTaken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = validateShop({ name, slug, phone });
  const create = useMutation({
    mutationFn: () => createOrg({ slug, name: name.trim(), kind, city: city.trim() || undefined, phone: normalizePhone(phone) }),
    onSuccess: (org) => {
      void qc.invalidateQueries({ queryKey: sk.myOrgs });
      router.replace({ pathname: '/seller/[orgId]', params: { orgId: org.id } });
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.status === 409 && e.detail<string>('field') === 'slug') return setSlugTaken(true);
      setError(sellerErrorMessage(e, t, locale));
    },
  });

  function submit() {
    setSubmitted(true);
    setError(null);
    if (Object.keys(errors).length > 0) return;
    create.mutate();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('seller.createShop') }} />
      <TextField
        label={t('seller.form.name')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (!slugTouched) setSlug(slugify(v));
        }}
        error={submitted && errors.name ? t('seller.form.nameRequired') : null}
        maxLength={120}
      />
      <TextField
        label={t('seller.form.slug')}
        hint={t('seller.form.slugHint')}
        value={slug}
        onChangeText={(v) => {
          setSlugTouched(true);
          setSlugTaken(false);
          setSlug(v.toLowerCase());
        }}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
        error={slugTaken ? t('seller.form.slugTaken') : submitted && errors.slug ? t('seller.form.slugInvalid') : null}
      />
      <Text variant="small" style={{ fontWeight: '600', marginBottom: 4 }}>
        {t('seller.form.kind')}
      </Text>
      <Chips scroll={false} options={KINDS.map((k) => ({ value: k, label: t(`seller.kind.${k}` as MessageKey) }))} value={kind} onChange={setKind} />
      <TextField label={t('seller.form.city')} value={city} onChangeText={setCity} maxLength={120} />
      <TextField
        label={t('seller.form.phone')}
        hint={t('seller.form.phoneHint')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        error={submitted && errors.phone ? t('seller.form.phoneInvalid') : null}
      />
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: 12 }}>
          {error}
        </Text>
      ) : null}
      <Button label={t('seller.form.create')} loading={create.isPending} onPress={submit} />
    </Screen>
  );
}
