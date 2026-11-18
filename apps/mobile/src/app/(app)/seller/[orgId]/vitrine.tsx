import type { UpdateOrgRequest } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { errorMessage } from '../../../../lib/errors';
import { imageMime, uploadImage } from '../../../../media/upload';
import { sk, useMembership } from '../../../../seller/api';
import { canEditProfile } from '../../../../seller/permissions';
import { Card, Loading, SectionTitle, sellerErrorMessage } from '../../../../seller/ui';
import { shopKeys } from '../../../../shop/hooks';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';
import { AuthImage, Button, ErrorState, Screen, Text, TextField } from '../../../../ui';
import { fetchGallery, fetchOrg, setGallery, updateOrg } from '../../../../vitrine/api';
import { buildHours, DAYS, formatDay, parseAreas } from '../../../../vitrine/logic';

type Row = Record<string, string>;
type Field = { key: string; label: MessageKey; multiline?: boolean; max: number };

const LINK_FIELDS: Field[] = [
  { key: 'label', label: 'vitrine.linkLabel', max: 40 },
  { key: 'url', label: 'vitrine.linkUrl', max: 500 },
];
const SECTION_FIELDS: Field[] = [
  { key: 'title', label: 'vitrine.sectionTitle', max: 80 },
  { key: 'body', label: 'vitrine.sectionBody', multiline: true, max: 2000 },
];
const FAQ_FIELDS: Field[] = [
  { key: 'question', label: 'vitrine.question', max: 200 },
  { key: 'answer', label: 'vitrine.answer', multiline: true, max: 1000 },
];

/** Liste de lignes modifiables (liens, sections, questions) : ajouter, modifier, supprimer. */
function Rows({ title, rows, onChange, fields, max }: { title: MessageKey; rows: Row[]; onChange: (r: Row[]) => void; fields: Field[]; max: number }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionTitle>{t(title)}</SectionTitle>
      {rows.map((row, i) => (
        <Card key={i}>
          {fields.map((f) => (
            <TextField
              key={f.key}
              label={t(f.label)}
              value={row[f.key] ?? ''}
              multiline={f.multiline}
              maxLength={f.max}
              autoCapitalize={f.key === 'url' ? 'none' : undefined}
              onChangeText={(v) => onChange(rows.map((r, j) => (j === i ? { ...r, [f.key]: v } : r)))}
            />
          ))}
          <Button variant="secondary" label={t('vitrine.remove')} onPress={() => onChange(rows.filter((_, j) => j !== i))} />
        </Card>
      ))}
      {rows.length < max ? <Button variant="secondary" label={t('vitrine.add')} onPress={() => onChange([...rows, {}])} /> : null}
    </View>
  );
}

/** Galerie de la vitrine : chaque ajout ou retrait est enregistré tout de suite (route à part). */
function Gallery({ orgId }: { orgId: string }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['org-gallery', orgId], queryFn: () => fetchGallery(orgId) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = q.data?.items ?? [];

  async function apply(ids: string[]) {
    qc.setQueryData(['org-gallery', orgId], await setGallery(orgId, ids));
    void qc.invalidateQueries({ queryKey: ['org-full', orgId] });
  }
  async function add() {
    setError(null);
    setBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 12 - items.length, quality: 0.8 });
      if (res.canceled) return;
      const uploaded: string[] = [];
      for (const a of res.assets.slice(0, 12 - items.length)) uploaded.push(await uploadImage(a.uri, imageMime(a.mimeType, a.uri), 'org_gallery'));
      await apply([...items.map((f) => f.id), ...uploaded]);
    } catch (e) {
      setError(errorMessage(e, t, locale));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setError(null);
    setBusy(true);
    try {
      await apply(items.filter((f) => f.id !== id).map((f) => f.id));
    } catch (e) {
      setError(errorMessage(e, t, locale));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionTitle>{t('vitrine.gallery')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {items.map((f, i) => (
          <Pressable key={f.id} accessibilityRole="button" accessibilityLabel={t('vitrine.gallery.remove', { n: i + 1 })} disabled={busy} onPress={() => remove(f.id)}>
            <AuthImage contentUrl={f.contentUrl} label={t('vitrine.gallery.photo', { n: i + 1 })} style={{ width: 88, height: 88 }} />
          </Pressable>
        ))}
      </View>
      {error ? <Text color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      {items.length < 12 ? <Button variant="secondary" label={t('vitrine.gallery.add')} loading={busy} onPress={add} /> : null}
    </View>
  );
}

const complete = (rows: Row[], fields: Field[]) => rows.map((r) => Object.fromEntries(fields.map((f) => [f.key, (r[f.key] ?? '').trim()]))).filter((r) => fields.every((f) => r[f.key]));

/** « Ma vitrine » (permission `org.profile.edit`) : logo, bannière, coordonnées, horaires, zones, liens, sections et questions. */
export default function Vitrine() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const { role, isPending, isError, error, refetch } = useMembership(orgId);
  const org = useQuery({ queryKey: ['org-full', orgId], queryFn: () => fetchOrg(orgId), enabled: !!orgId });

  const [ready, setReady] = useState(false);
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [timezone, setTimezone] = useState('Africa/Lubumbashi');
  const [hours, setHours] = useState<Record<(typeof DAYS)[number], string>>({ mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' });
  const [areas, setAreas] = useState('');
  const [links, setLinks] = useState<Row[]>([]);
  const [sections, setSections] = useState<Row[]>([]);
  const [faq, setFaq] = useState<Row[]>([]);
  // undefined = inchangé, identifiant = nouvelle image envoyée, null = retirée.
  const [logo, setLogo] = useState<{ id: string | null; uri?: string } | undefined>();
  const [banner, setBanner] = useState<{ id: string | null; uri?: string } | undefined>();
  const [info, setInfo] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const o = org.data;
    if (ready || !o) return;
    setReady(true);
    setDescription(o.description ?? '');
    setPhone(o.phone ?? '');
    setEmail(o.email ?? '');
    setWebsite(o.website ?? '');
    setAddress(o.address ?? '');
    setCity(o.city ?? '');
    setTimezone(o.timezone);
    setHours({ mon: formatDay(o.openingHours?.mon), tue: formatDay(o.openingHours?.tue), wed: formatDay(o.openingHours?.wed), thu: formatDay(o.openingHours?.thu), fri: formatDay(o.openingHours?.fri), sat: formatDay(o.openingHours?.sat), sun: formatDay(o.openingHours?.sun) });
    setAreas(o.page.serviceAreas.join('\n'));
    setLinks(o.page.links.map((l) => ({ ...l })));
    setSections(o.page.sections.map((s) => ({ ...s })));
    setFaq(o.page.faq.map((q) => ({ ...q })));
  }, [org.data, ready]);

  const save = useMutation({
    mutationFn: () => {
      const openingHours = buildHours(hours);
      if (openingHours === 'invalid') throw new Error('hours');
      const body: UpdateOrgRequest = {
        description: description.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        website: website.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
        openingHours,
        page: {
          links: complete(links, LINK_FIELDS) as { label: string; url: string }[],
          serviceAreas: parseAreas(areas),
          sections: complete(sections, SECTION_FIELDS) as { title: string; body: string }[],
          faq: complete(faq, FAQ_FIELDS) as { question: string; answer: string }[],
        },
        ...(logo ? { logoMediaId: logo.id } : {}),
        ...(banner ? { bannerMediaId: banner.id } : {}),
      };
      return updateOrg(orgId, body);
    },
    onSuccess: (o) => {
      setInfo({ text: t('vitrine.saved'), tone: 'ok' });
      setLogo(undefined);
      setBanner(undefined);
      qc.setQueryData(['org-full', orgId], o);
      void qc.invalidateQueries({ queryKey: shopKeys.store(o.slug) });
      void qc.invalidateQueries({ queryKey: sk.myOrgs });
    },
    onError: (e) => setInfo({ text: e instanceof Error && e.message === 'hours' ? t('vitrine.hoursInvalid') : sellerErrorMessage(e, t, locale), tone: 'error' }),
  });

  async function pick(kind: 'org_logo' | 'org_banner') {
    setInfo(null);
    setBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: kind === 'org_logo' ? [1, 1] : [16, 9], quality: 0.8 });
      if (res.canceled) return;
      const a = res.assets[0]!;
      const id = await uploadImage(a.uri, imageMime(a.mimeType, a.uri), kind);
      (kind === 'org_logo' ? setLogo : setBanner)({ id, uri: a.uri });
    } catch (e) {
      setInfo({ text: e instanceof Error ? errorMessage(e, t, locale) : t('vitrine.photoFailed'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const title = <Stack.Screen options={{ title: t('vitrine.title') }} />;
  if (isPending || org.isPending) return <>{title}<Loading /></>;
  if (isError) return <>{title}<ErrorState error={error} onRetry={() => refetch()} /></>;
  if (org.isError) return <>{title}<ErrorState error={org.error} onRetry={() => org.refetch()} /></>;
  if (!canEditProfile(role)) return <>{title}<Screen><Text muted>{t('vitrine.forbidden')}</Text></Screen></>;

  const o = org.data;
  const logoUrl = logo ? null : o.logoUrl;
  const bannerUrl = banner ? null : o.bannerUrl;
  return (
    <>
      {title}
      <Screen edges={['bottom']}>
        <View style={{ gap: spacing.md }}>
          <Button variant="secondary" label={t('vitrine.view')} onPress={() => router.push(`/store/${o.slug}` as never)} />

          <SectionTitle>{t('vitrine.images')}</SectionTitle>
          <AuthImage contentUrl={bannerUrl} localUri={banner?.uri} label={o.name} style={{ width: '100%', height: 120 }} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button variant="secondary" label={t('vitrine.banner')} disabled={busy} onPress={() => pick('org_banner')} />
            {bannerUrl || banner?.uri ? <Button variant="secondary" label={t('vitrine.removeImage')} onPress={() => setBanner({ id: null })} /> : null}
          </View>
          <AuthImage contentUrl={logoUrl} localUri={logo?.uri} label={o.name} style={{ width: 80, height: 80 }} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button variant="secondary" label={t('vitrine.logo')} disabled={busy} onPress={() => pick('org_logo')} />
            {logoUrl || logo?.uri ? <Button variant="secondary" label={t('vitrine.removeImage')} onPress={() => setLogo({ id: null })} /> : null}
          </View>

          <Gallery orgId={orgId} />

          <SectionTitle>{t('vitrine.about')}</SectionTitle>
          <TextField label={t('vitrine.description')} value={description} onChangeText={setDescription} multiline maxLength={2000} />

          <SectionTitle>{t('vitrine.contact')}</SectionTitle>
          <TextField label={t('vitrine.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoCapitalize="none" />
          <TextField label={t('vitrine.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextField label={t('vitrine.website')} value={website} onChangeText={setWebsite} keyboardType="url" autoCapitalize="none" />
          <TextField label={t('vitrine.address')} value={address} onChangeText={setAddress} maxLength={300} />
          <TextField label={t('vitrine.city')} value={city} onChangeText={setCity} maxLength={120} />
          <TextField label={t('pos.timezone')} value={timezone} onChangeText={setTimezone} autoCapitalize="none" autoCorrect={false} maxLength={64} />

          <SectionTitle>{t('vitrine.hours')}</SectionTitle>
          <Text variant="caption" muted>{t('vitrine.hoursHint')}</Text>
          {DAYS.map((d) => (
            <TextField key={d} label={t(`shop.day.${d}` as MessageKey)} value={hours[d]} onChangeText={(v) => setHours((h) => ({ ...h, [d]: v }))} autoCapitalize="none" />
          ))}

          <SectionTitle>{t('vitrine.areas')}</SectionTitle>
          <TextField label={t('vitrine.areasHint')} value={areas} onChangeText={setAreas} multiline />

          <Rows title="vitrine.links" rows={links} onChange={setLinks} fields={LINK_FIELDS} max={8} />
          <Rows title="vitrine.sections" rows={sections} onChange={setSections} fields={SECTION_FIELDS} max={10} />
          <Rows title="vitrine.faq" rows={faq} onChange={setFaq} fields={FAQ_FIELDS} max={20} />

          {info ? (
            <Text color={info.tone === 'ok' ? colors.success : colors.danger} accessibilityLiveRegion="polite">
              {info.text}
            </Text>
          ) : null}
          <Button label={t('vitrine.save')} loading={save.isPending} disabled={busy} onPress={() => { setInfo(null); save.mutate(); }} />
        </View>
      </Screen>
    </>
  );
}
