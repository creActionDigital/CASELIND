import type { AdObjective, AdPlacement } from '@caselind/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { createCampaign } from '../../../ads/api';
import { AD_PLACEMENTS, budgetRange, checkCampaignForm, cpcMinor, isoDay, parseInterests } from '../../../ads/logic';
import { useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { safeBack } from '../../../lib/back-target';
import { uuidv4 } from '../../../lib/uuid';
import { PinSheet } from '../../../premium/PinSheet';
import { fetchMyOrgs, fetchProducts } from '../../../seller/api';
import { Card, Chips } from '../../../seller/ui';
import { fetchUserPosts } from '../../../social/api';
import { formatMoney } from '../../../shop/format';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Text, TextField } from '../../../ui';
import { WALLET_CURRENCIES } from '../../../wallet/amount';
import { SandboxBanner } from '../../../wallet/ui';

type Target = 'post' | 'product';
const OBJECTIVES: AdObjective[] = ['reach', 'clicks', 'sales'];

/** Création d'une campagne : objectif, cible, audience, budget, dates, emplacements, aperçu, puis paiement par PIN (mode test). */
export default function NewCampaign() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useAuth();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<AdObjective>('clicks');
  const [target, setTarget] = useState<Target>('post');
  const [postId, setPostId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [minAge, setMinAge] = useState('');
  const [interests, setInterests] = useState('');
  const [currency, setCurrency] = useState<string>(WALLET_CURRENCIES[0]);
  const [budget, setBudget] = useState('');
  const [daily, setDaily] = useState('');
  const [startsOn, setStartsOn] = useState(isoDay());
  const [endsOn, setEndsOn] = useState(isoDay(7));
  const [placements, setPlacements] = useState<AdPlacement[]>(['feed', 'marketplace']);
  const [issue, setIssue] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const key = useRef<{ sig: string; id: string } | null>(null);

  const posts = useQuery({ queryKey: ['ad-my-posts', me?.id], queryFn: () => fetchUserPosts(me!.id), enabled: !!me });
  const orgs = useQuery({ queryKey: ['seller', 'my-orgs'], queryFn: fetchMyOrgs, enabled: target === 'product' });
  const myOrgs = (orgs.data?.items ?? []).filter((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin'));
  const org = orgId ?? myOrgs[0]?.org.id ?? null;
  const products = useQuery({ queryKey: ['ad-org-products', org], queryFn: () => fetchProducts(org!, 'published'), enabled: target === 'product' && !!org });
  const publicPosts = (posts.data?.items ?? []).filter((p) => p.visibility === 'public');

  const chosenPost = publicPosts.find((p) => p.id === postId);
  const chosenProduct = products.data?.items.find((p) => p.id === productId);
  const previewTitle = target === 'post' ? chosenPost?.body ?? name : chosenProduct?.title ?? name;
  const money = (m: number) => formatMoney(m, currency, locale);
  const { min, max } = budgetRange(currency);

  const form = () => ({ name, hasTarget: target === 'post' ? !!postId : !!productId && !!org, budget, daily, currency, startsOn, endsOn, placements, minAge, country });
  const issueText = (r: ReturnType<typeof checkCampaignForm> & { issue: { key: string; min?: number; max?: number } }) => {
    const k = r.issue.key;
    return t(`mon.ads.err.${k}` as MessageKey, { min: money(r.issue.min ?? min), max: money(r.issue.max ?? max) });
  };
  const next = () => {
    const r = checkCampaignForm(form());
    if ('issue' in r) setIssue(issueText(r));
    else {
      setIssue(null);
      setPaying(true);
    }
  };

  const submit = async (pin: string) => {
    const r = checkCampaignForm(form());
    if ('issue' in r) return;
    const sig = JSON.stringify([form(), objective, postId, productId, org, interests, city]);
    if (key.current?.sig !== sig) key.current = { sig, id: uuidv4() };
    await createCampaign({
      clientId: key.current.id,
      name: name.trim(),
      objective,
      ...(target === 'post' ? { postId: postId! } : { productId: productId!, orgId: org! }),
      audience: { country: country.trim() ? country.trim().toUpperCase() : null, city: city.trim() || null, minAge: minAge.trim() ? Number(minAge) : null, interests: parseInterests(interests) },
      placements,
      budgetMinor: r.budgetMinor,
      dailyBudgetMinor: r.dailyMinor,
      currency,
      startsOn,
      endsOn,
      pin,
    });
    key.current = null;
    setPaying(false);
    void qc.invalidateQueries({ queryKey: ['ad-campaigns'] });
    void qc.invalidateQueries({ queryKey: ['wallet'] });
    void qc.invalidateQueries({ queryKey: ['ad-billing'] });
    safeBack(router, '/ads');
  };

  const section = (k: MessageKey) => (
    <Text variant="heading" accessibilityRole="header">
      {t(k)}
    </Text>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('mon.ads.new.title') }} />
      <SandboxBanner />
      <TextField label={t('mon.ads.f.name')} value={name} onChangeText={setName} maxLength={80} />
      {section('mon.ads.f.objective')}
      <Chips value={objective} onChange={setObjective} options={OBJECTIVES.map((o) => ({ value: o, label: t(`mon.ads.obj.${o}` as MessageKey) }))} />

      {section('mon.ads.f.target')}
      <Chips value={target} onChange={setTarget} scroll={false} options={[{ value: 'post', label: t('mon.ads.target.post') }, { value: 'product', label: t('mon.ads.target.product') }]} />
      {target === 'post' ? (
        <>
          <Text variant="small" muted>
            {t('mon.ads.f.pickPost')}
          </Text>
          {posts.data && publicPosts.length === 0 ? <Text muted>{t('mon.ads.noPosts')}</Text> : null}
          <Chips value={postId} onChange={setPostId} options={publicPosts.slice(0, 12).map((p) => ({ value: p.id, label: (p.body ?? '').slice(0, 24) || p.id.slice(0, 6) }))} />
        </>
      ) : (
        <>
          {myOrgs.length > 1 ? <Chips value={org} onChange={(v) => { setOrgId(v); setProductId(null); }} options={myOrgs.map((m) => ({ value: m.org.id, label: m.org.name }))} /> : null}
          <Text variant="small" muted>
            {t('mon.ads.f.pickProduct')}
          </Text>
          {products.data && products.data.items.length === 0 ? <Text muted>{t('mon.ads.noProducts')}</Text> : null}
          <Chips value={productId} onChange={setProductId} options={(products.data?.items ?? []).map((p) => ({ value: p.id, label: p.title.slice(0, 24) }))} />
        </>
      )}

      {section('mon.ads.f.audience')}
      <TextField label={t('mon.ads.f.country')} value={country} onChangeText={setCountry} maxLength={2} autoCapitalize="characters" />
      <TextField label={t('mon.ads.f.city')} value={city} onChangeText={setCity} maxLength={80} />
      <TextField label={t('mon.ads.f.minAge')} value={minAge} onChangeText={setMinAge} keyboardType="number-pad" maxLength={2} />
      <TextField label={t('mon.ads.f.interests')} value={interests} onChangeText={setInterests} />
      <Text variant="small" muted>
        {t('mon.ads.audience.note')}
      </Text>

      <Chips value={currency} onChange={setCurrency} scroll={false} options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} />
      <TextField label={t('mon.ads.f.budget')} value={budget} onChangeText={setBudget} keyboardType="decimal-pad" />
      <TextField label={t('mon.ads.f.daily')} value={daily} onChangeText={setDaily} keyboardType="decimal-pad" />
      <Text variant="small" muted>
        {t('mon.ads.cpc', { price: money(cpcMinor(currency)) })}
      </Text>
      <TextField label={t('mon.ads.f.startsOn')} value={startsOn} onChangeText={setStartsOn} maxLength={10} />
      <TextField label={t('mon.ads.f.endsOn')} value={endsOn} onChangeText={setEndsOn} maxLength={10} />

      {section('mon.ads.f.placements')}
      <Chips
        value={null}
        onChange={(p: AdPlacement) => setPlacements((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))}
        options={AD_PLACEMENTS.map((p) => ({ value: p, label: `${placements.includes(p) ? '✓ ' : ''}${t(`mon.ads.pl.${p}` as MessageKey)}` }))}
      />

      {section('mon.ads.preview')}
      <Card style={{ gap: spacing.xs }}>
        <Text variant="caption" color={colors.primary} style={{ fontWeight: '700' }}>
          {t('creator.sponsored')}
        </Text>
        <Text numberOfLines={3}>{previewTitle || t('mon.ads.f.name')}</Text>
      </Card>
      <Text variant="small" muted>
        {t('mon.ads.preview.note')}
      </Text>

      {issue ? (
        <Text color={colors.danger} accessibilityRole="alert">
          {issue}
        </Text>
      ) : null}
      <Button label={t('mon.ads.submit')} onPress={next} />
      <View style={{ height: spacing.xl }} />
      <PinSheet
        visible={paying}
        hint={t('mon.ads.pinHint', { amount: money(Number.isFinite(Number(budget)) ? checkMinor(budget, currency) : 0) })}
        onClose={() => setPaying(false)}
        onSubmit={submit}
      />
    </ScrollView>
  );
}

function checkMinor(input: string, currency: string): number {
  const r = checkCampaignForm({ name: 'xx', hasTarget: true, budget: input, daily: input, currency, startsOn: isoDay(), endsOn: isoDay(), placements: ['feed'], minAge: '', country: '' });
  return 'budgetMinor' in r ? r.budgetMinor : 0;
}

const styles = StyleSheet.create({ pad: { padding: spacing.lg, gap: spacing.md } });
