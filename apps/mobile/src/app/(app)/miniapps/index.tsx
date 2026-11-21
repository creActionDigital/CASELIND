import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip, ChipRow, SkeletonList } from '../../../ui/premium';
import { MINIAPP_CATEGORIES, type MiniAppPublic } from '@caselind/contracts';
import { fetchFavoriteApps, mdKeys, setFavoriteApp } from '../../../messaging/module-d-api';
import { loadRecents, pushRecent } from '../../../miniapps/recents';
import { useI18n, type MessageKey } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { CertBadge, ManifestSummary } from '../../../miniapps/ManifestSummary';
import { fetchMiniApp } from '../../../miniapps/api';
import { setAppMuted } from '../../../miniapps/platform-api';
import { confirmPayment, declinePayment, fetchDirectory, fetchGrants, fetchPaymentRequests, maKeys, revokeGrant } from '../../../miniapps/api';
import { Card, Chips, Loading } from '../../../seller/ui';
import { formatMoney } from '../../../shop/format';
import { brandAccent, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

type Tab = 'directory' | 'favorites' | 'recent' | 'mine' | 'payments';

/** Annuaire des mini-apps, apps autorisées (révocation) et demandes de paiement (confirmation par PIN). */
export default function MiniApps() {
  const { t } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('directory');
  return (
    <Screen>
      <Stack.Screen options={{ title: t('miniapps.title') }} />
      <Button variant="secondary" label={t('miniapps.dev.open')} onPress={() => router.push('/miniapps/developer' as never)} />
      <ChipRow>
        {([['directory', t('miniapps.title')], ['favorites', t('md.apps.tabFavorites')], ['recent', t('md.apps.tabRecent')], ['mine', t('miniapps.mine')], ['payments', t('miniapps.payments')]] as [Tab, string][]).map(([v, label]) => (
          <Chip key={v} label={label} selected={tab === v} onPress={() => setTab(v)} />
        ))}
      </ChipRow>
      <View style={{ gap: spacing.md, marginTop: spacing.md }}>
        {tab === 'directory' ? <Directory /> : tab === 'favorites' ? <Favorites /> : tab === 'recent' ? <Recents /> : tab === 'mine' ? <Mine onDiscover={() => setTab('directory')} /> : <Payments onDiscover={() => setTab('directory')} />}
      </View>
    </Screen>
  );
}

const scopeKey = (s: string) => `miniapps.scope.${s}` as MessageKey;

function Directory() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const list = useInfiniteQuery({
    queryKey: maKeys.directory(q, category),
    queryFn: ({ pageParam }) => fetchDirectory(q.trim(), pageParam, category),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <TextField label={t('miniapps.search')} value={q} onChangeText={setQ} autoCapitalize="none" />
      <Chips<string>
        value={category}
        onChange={setCategory}
        options={[{ value: '', label: t('md.apps.catAll') }, ...MINIAPP_CATEGORIES.map((c) => ({ value: c as string, label: t(`md.apps.cat.${c}` as MessageKey) }))]}
      />
      {list.isPending ? <SkeletonList rows={3} label={t('common.loading')} /> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.data && items.length === 0 ? <Text muted>{t('miniapps.empty')}</Text> : null}
      {items.map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>{a.name}</Text>
            <FavoriteHeart appId={a.id} />
          </View>
          <Text variant="small" muted>{t('miniapps.by', { name: a.organization.name })}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            <CertBadge level={a.certification} />
            {a.organization.verified ? <Badge tone="accent" label={t('miniapps.verified')} /> : null}
          </View>
          {a.description ? <Text>{a.description}</Text> : null}
          <Text variant="small" style={{ fontWeight: '600' }}>{t('miniapps.scopes')}</Text>
          {a.scopes.map((s) => <Text key={s} variant="small">• {t(scopeKey(s))}</Text>)}
          <Details id={a.id} />
          <Text variant="caption" muted>{t('miniapps.openHint')}</Text>
          <Button variant="secondary" label={t('miniapps.open')} onPress={() => { void pushRecent(a.id); void Linking.openURL(a.launchUrl); }} />
        </Card>
      ))}
      {list.hasNextPage ? <Button variant="ghost" label={t('miniapps.more')} loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} /> : null}
    </>
  );
}

/** Manifeste approuvé de l'application (données consultées, coûts, conditions), chargé à la demande. */
function Details({ id }: { id: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['miniapps', 'one', id], queryFn: () => fetchMiniApp(id), enabled: open });
  return (
    <>
      <Button variant="ghost" label={t(open ? 'mp.details.hide' : 'mp.details.show')} onPress={() => setOpen(!open)} />
      {open && q.isPending ? <Loading /> : null}
      {open && q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {open && q.data ? <ManifestSummary manifest={q.data.manifest} /> : null}
    </>
  );
}

function Mine({ onDiscover }: { onDiscover: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const q = useQuery({ queryKey: maKeys.grants, queryFn: fetchGrants });
  const mute = useMutation({
    mutationFn: (v: { appId: string; muted: boolean }) => setAppMuted(v.appId, v.muted),
    onSuccess: () => void qc.invalidateQueries({ queryKey: maKeys.grants }),
  });
  const revoke = useMutation({
    mutationFn: revokeGrant,
    onSuccess: () => {
      setConfirming(null);
      void qc.invalidateQueries({ queryKey: maKeys.grants });
      void qc.invalidateQueries({ queryKey: maKeys.payments });
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data.items.length === 0) return <><Text muted>{t('miniapps.mine.empty')}</Text><Button variant="secondary" label={t('miniapps.discover')} onPress={onDiscover} /></>;
  return (
    <>
      {q.data.items.map((g) => (
        <Card key={g.appId}>
          <Text variant="bodyStrong">{g.name}</Text>
          <Text variant="small" muted>{t('miniapps.by', { name: g.organizationName })}</Text>
          {g.scopes.map((s) => <Text key={s} variant="small">• {t(scopeKey(s))}</Text>)}
          {g.reconsentRequired ? <Text variant="small">{t('miniapps.mine.reconsent')}</Text> : null}
          <Text variant="caption" muted>{t('miniapps.mine.since', { date: new Date(g.grantedAt).toLocaleDateString(locale) })}</Text>
          {confirming === g.appId ? (
            <>
              <Text variant="small">{t('miniapps.revoke.confirm', { name: g.name })}</Text>
              <Button variant="danger" label={t('miniapps.revoke')} loading={revoke.isPending} onPress={() => revoke.mutate(g.appId)} />
              <Button variant="ghost" label={t('miniapps.pay.cancel')} onPress={() => setConfirming(null)} />
              {revoke.isError ? <ErrorState error={revoke.error} /> : null}
            </>
          ) : (
            <>
              {g.scopes.includes('notify') ? (
                <Button
                  variant="ghost"
                  label={t(g.notificationsMuted ? 'mp.notify.unmute' : 'mp.notify.mute')}
                  loading={mute.isPending}
                  onPress={() => mute.mutate({ appId: g.appId, muted: !g.notificationsMuted })}
                />
              ) : null}
              <Button variant="ghost" label={t('miniapps.activity.open')} onPress={() => router.push(`/miniapps/activity/${g.appId}` as never)} />
              <Button variant="secondary" label={t('miniapps.revoke')} onPress={() => setConfirming(g.appId)} />
            </>
          )}
        </Card>
      ))}
    </>
  );
}

function Payments({ onDiscover }: { onDiscover: () => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [paying, setPaying] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: maKeys.payments, queryFn: fetchPaymentRequests });
  const done = () => {
    setPaying(null);
    setPin('');
    setErr(null);
    void qc.invalidateQueries({ queryKey: maKeys.payments });
  };
  const pay = useMutation({
    mutationFn: (id: string) => confirmPayment(id, pin),
    onSuccess: done,
    onError: (e) => {
      const reason = e instanceof ApiRequestError ? e.detail<string>('reason') : undefined;
      if (reason === 'request_closed') return done();
      setErr(reason === 'pin_locked' ? t('miniapps.err.locked') : reason === 'pin_invalid' ? t('miniapps.err.pin') : errorMessage(e, t, locale));
    },
  });
  const decline = useMutation({ mutationFn: declinePayment, onSuccess: done });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const pending = q.data.items.filter((r) => r.status === 'pending');
  if (pending.length === 0) return <><Text muted>{t('miniapps.pay.empty')}</Text><Button variant="secondary" label={t('miniapps.discover')} onPress={onDiscover} /></>;
  return (
    <>
      {pending.map((r) => (
        <Card key={r.id}>
          <Text variant="bodyStrong">{formatMoney(r.amountMinor, r.currency, locale)}</Text>
          <Text variant="small" muted>{t('miniapps.pay.from', { name: r.appName })}</Text>
          {r.description ? <Text>{r.description}</Text> : null}
          <Text variant="caption" muted>{t('miniapps.pay.expires', { time: new Date(r.expiresAt).toLocaleTimeString(locale) })}</Text>
          {paying === r.id ? (
            <>
              <TextField label={t('miniapps.pay.pin')} value={pin} onChangeText={setPin} keyboardType="number-pad" maxLength={16} secure error={err} />
              <Text variant="caption" muted>{t('miniapps.pay.sandbox')}</Text>
              <Button label={t('miniapps.pay.confirm')} disabled={pin.length === 0} loading={pay.isPending} onPress={() => pay.mutate(r.id)} />
              <Button variant="ghost" label={t('miniapps.pay.cancel')} onPress={done} />
            </>
          ) : (
            <>
              <Button label={t('miniapps.pay.pay')} onPress={() => setPaying(r.id)} />
              <Button variant="ghost" label={t('miniapps.pay.decline')} loading={decline.isPending} onPress={() => decline.mutate(r.id)} />
              {decline.isError && decline.variables === r.id ? <Text color={colors.danger}>{errorMessage(decline.error, t, locale)}</Text> : null}
            </>
          )}
        </Card>
      ))}
    </>
  );
}

function FavoriteHeart({ appId }: { appId: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const favs = useQuery({ queryKey: mdKeys.favorites, queryFn: fetchFavoriteApps });
  const on = !!favs.data?.items.some((a) => a.id === appId);
  const toggle = useMutation({ mutationFn: () => setFavoriteApp(appId, !on), onSettled: () => void qc.invalidateQueries({ queryKey: mdKeys.favorites }) });
  const label = on ? t('md.apps.favRemove') : t('md.apps.favAdd');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => toggle.mutate()} hitSlop={10} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={on ? 'heart' : 'heart-outline'} size={24} color={on ? brandAccent : colors.textMuted} />
    </Pressable>
  );
}

function AppRows({ items }: { items: MiniAppPublic[] }) {
  const { t } = useI18n();
  return (
    <>
      {items.map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>{a.name}</Text>
            <FavoriteHeart appId={a.id} />
          </View>
          <Text variant="small" muted>{t('miniapps.by', { name: a.organization.name })}</Text>
          {a.description ? <Text>{a.description}</Text> : null}
          <Button variant="secondary" label={t('miniapps.open')} onPress={() => { void pushRecent(a.id); void Linking.openURL(a.launchUrl); }} />
        </Card>
      ))}
    </>
  );
}

function Favorites() {
  const { t } = useI18n();
  const favs = useQuery({ queryKey: mdKeys.favorites, queryFn: fetchFavoriteApps });
  if (favs.isPending) return <Loading />;
  if (favs.isError) return <ErrorState error={favs.error} onRetry={() => void favs.refetch()} />;
  return favs.data.items.length === 0 ? <Text muted>{t('md.apps.favEmpty')}</Text> : <AppRows items={favs.data.items} />;
}

function Recents() {
  const { t } = useI18n();
  const apps = useQuery({
    queryKey: mdKeys.recents,
    queryFn: async () => {
      const ids = await loadRecents();
      const found = await Promise.all(ids.map((id) => fetchMiniApp(id).catch(() => null)));
      return found.filter((a): a is MiniAppPublic => a !== null);
    },
  });
  if (apps.isPending) return <Loading />;
  if (apps.isError) return <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />;
  return apps.data.length === 0 ? <Text muted>{t('md.apps.recentEmpty')}</Text> : <AppRows items={apps.data} />;
}
