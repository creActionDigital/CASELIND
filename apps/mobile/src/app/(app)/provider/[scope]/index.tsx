import type { ServiceProfile } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { ApiRequestError } from '../../../../lib/api';
import { useMyOrgs } from '../../../../seller/api';
import { can } from '../../../../seller/permissions';
import { Card, Loading, SectionTitle } from '../../../../seller/ui';
import { fetchOwnOffers, fetchProfile, saveProfile, svcKeys, type Scope } from '../../../../services/api';
import { parseSkills } from '../../../../services/logic';
import { priceLabel, svcErrorMessage } from '../../../../services/ui';
import { Badge, Button, EmptyState, ErrorState, Text, TextField } from '../../../../ui';
import { spacing } from '../../../../theme/tokens';
import { useTheme } from '../../../../theme/use-theme';

/** Espace prestataire : profil individuel (`me`) ou services d'une organisation, offres et raccourcis. */
export default function ProviderHome() {
  const { t } = useI18n();
  const { scope } = useLocalSearchParams<{ scope: string }>();
  const title = <Stack.Screen options={{ title: scope === 'me' ? t('services.pro.title') : t('services.pro.orgServices') }} />;
  return (
    <>
      {title}
      {scope === 'me' ? <IndividualGate /> : <OrgGate orgId={scope} />}
    </>
  );
}

function IndividualGate() {
  const profile = useQuery({
    queryKey: svcKeys.profile,
    queryFn: fetchProfile,
    retry: (n, e) => !(e instanceof ApiRequestError && e.status === 404) && n < 2,
  });
  const [editing, setEditing] = useState(false);
  if (profile.isPending) return <Loading />;
  const missing = profile.isError && profile.error instanceof ApiRequestError && profile.error.status === 404;
  if (profile.isError && !missing) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  if (missing || editing) {
    return <ProfileForm initial={missing ? null : profile.data!} onDone={() => setEditing(false)} />;
  }
  return <Hub scope="me" heading={profile.data!.displayName} onEditProfile={() => setEditing(true)} />;
}

function OrgGate({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const orgs = useMyOrgs();
  if (orgs.isPending) return <Loading />;
  if (orgs.isError) return <ErrorState error={orgs.error} onRetry={() => orgs.refetch()} />;
  const m = orgs.data.items.find((x) => x.status === 'active' && x.org.id === orgId);
  if (!m || !can(m.role, 'catalog.manage')) return <EmptyState icon="lock-closed-outline" title={t('services.pro.noAccess')} />;
  return <Hub scope={orgId} heading={m.org.name} />;
}

function Hub({ scope, heading, onEditProfile }: { scope: Scope; heading: string; onEditProfile?: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const offers = useQuery({ queryKey: svcKeys.offers(scope), queryFn: () => fetchOwnOffers(scope) });
  const go = (path: string) => router.push(`/provider/${scope}${path}` as never);
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
      <Text variant="title" accessibilityRole="header">
        {heading}
      </Text>
      <Card label={t('services.pro.requests')} onPress={() => go('/requests')}>
        <View style={styles.line}>
          <Ionicons name="mail-unread-outline" size={24} color={colors.primary} />
          <Text style={{ flex: 1 }}>{t('services.pro.requests')}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>
      </Card>
      {onEditProfile ? (
        <Card label={t('services.pro.profile.edit')} onPress={onEditProfile}>
          <View style={styles.line}>
            <Ionicons name="person-circle-outline" size={24} color={colors.primary} />
            <Text style={{ flex: 1 }}>{t('services.pro.profile.edit')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </Card>
      ) : null}

      <SectionTitle>{t('services.pro.offers')}</SectionTitle>
      <Button label={t('services.pro.offers.new')} onPress={() => go('/offer/new')} />
      {offers.isPending ? (
        <Loading />
      ) : offers.isError ? (
        <ErrorState error={offers.error} onRetry={() => offers.refetch()} />
      ) : offers.data.items.length === 0 ? (
        <Text muted>{t('services.pro.offers.empty')}</Text>
      ) : (
        offers.data.items.map((o) => (
          <Card key={o.id} label={o.title} onPress={() => go(`/offer/${o.id}`)}>
            <View style={styles.between}>
              <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {o.title}
              </Text>
              <Badge tone={o.status === 'published' ? 'primary' : 'neutral'} label={t(`services.pro.status.${o.status}` as MessageKey)} />
            </View>
            <Text variant="small" muted>
              {priceLabel(o, t, locale)} · {t('services.duration', { n: o.durationMin })}
            </Text>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

function ProfileForm({ initial, onDone }: { initial: ServiceProfile | null; onDone: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.displayName ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [city, setCity] = useState(initial?.city ?? 'Goma');
  const [skills, setSkills] = useState((initial?.skills ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);

  const save = useMutation({
    mutationFn: () => saveProfile({ displayName: name.trim(), bio: bio.trim() || null, city: city.trim() || null, skills: parseSkills(skills) }),
    onMutate: () => setError(null),
    onSuccess: (p) => {
      qc.setQueryData(svcKeys.profile, p);
      onDone();
    },
    onError: (e) => setError(svcErrorMessage(e, t, locale)),
  });
  function submit() {
    const bad = !name.trim() || name.trim().length > 80;
    setNameError(bad);
    if (!bad) save.mutate();
  }
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      {!initial ? (
        <Text muted style={{ marginBottom: spacing.lg }}>
          {t('services.pro.intro')}
        </Text>
      ) : null}
      <Text variant="heading" accessibilityRole="header" style={{ marginBottom: spacing.md }}>
        {t('services.pro.profile.title')}
      </Text>
      <TextField label={t('services.pro.profile.name')} value={name} onChangeText={setName} maxLength={80} error={nameError ? t('services.pro.profile.err.name') : null} />
      <TextField label={t('services.pro.profile.bio')} value={bio} onChangeText={setBio} multiline maxLength={1000} />
      <TextField label={t('services.pro.profile.city')} value={city} onChangeText={setCity} maxLength={100} />
      <TextField label={t('services.pro.profile.skills')} value={skills} onChangeText={setSkills} />
      <Text variant="small" muted style={{ marginBottom: spacing.md }}>
        {t('services.pro.profile.unverified')}
      </Text>
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>
          {error}
        </Text>
      ) : null}
      <Button label={initial ? t('services.pro.profile.save') : t('services.pro.profile.create')} loading={save.isPending} onPress={submit} />
      {initial ? <Button variant="ghost" label={t('common.cancel')} onPress={onDone} /> : <Button variant="ghost" label={t('common.back')} onPress={() => router.back()} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  between: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
