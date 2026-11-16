import type { MissionCategory } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { fetchMyProfile, frKeys, saveMyProfile } from '../../../freelance/api';
import { categoryKey, CATEGORY_VALUES, parseSkills } from '../../../freelance/logic';
import { Chips } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { minorToDecimalString } from '../../../seller/money';
import { parseWalletAmount, WALLET_CURRENCIES } from '../../../wallet/amount';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

/** Mon profil freelance public : désactivé par défaut, jamais de coordonnées, retirable à tout moment. */
export default function FreelanceProfile() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: frKeys.profile, queryFn: fetchMyProfile });
  const [enabled, setEnabled] = useState<'on' | 'off'>('off');
  const [title, setTitle] = useState('');
  const [skills, setSkills] = useState('');
  const [category, setCategory] = useState<MissionCategory | 'all'>('all');
  const [rate, setRate] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const p = q.data;
    if (!p) return;
    setEnabled(p.enabled ? 'on' : 'off');
    setTitle(p.title);
    setSkills(p.skills.join(', '));
    setCategory(p.categories[0] ?? 'all');
    setRate(p.rateMinor !== null && p.rateCurrency ? minorToDecimalString(p.rateMinor, p.rateCurrency) : '');
    setCurrency(p.rateCurrency ?? 'USD');
    setBio(p.bio);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      let rateMinor: number | null = null;
      if (rate.trim()) {
        const p = parseWalletAmount(rate, currency);
        if ('issue' in p || p.minor <= 0) throw new Error('invalid');
        rateMinor = p.minor;
      }
      return saveMyProfile({
        enabled: enabled === 'on',
        title: title.trim(),
        skills: parseSkills(skills),
        categories: category === 'all' ? [] : [category],
        rateMinor,
        rateCurrency: rateMinor === null ? null : (currency as 'USD' | 'CDF'),
        bio: bio.trim(),
      });
    },
    onSuccess: () => {
      setError(null);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['freelance', 'freelancers'] });
      void qc.invalidateQueries({ queryKey: frKeys.profile });
    },
    onError: (e) => setError((e instanceof Error && e.message === 'invalid') || (e instanceof ApiRequestError && e.status === 400) ? t('freelance.err.invalid') : errorMessage(e, t, locale)),
  });

  if (q.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (q.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Screen>
    );
  }

  const touch = (set: (v: string) => void) => (v: string) => {
    setSaved(false);
    set(v);
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('freelance.myProfile') }} />
      <View style={styles.form}>
        <View style={[styles.note, { backgroundColor: colors.surface }]}>
          <Text variant="small" muted>
            {t('freelance.profile.hint')}
          </Text>
        </View>
        <Chips
          options={[
            { value: 'on' as const, label: t('freelance.profile.enabled') },
            { value: 'off' as const, label: t('freelance.profile.disabled') },
          ]}
          value={enabled}
          onChange={(v) => {
            setSaved(false);
            setEnabled(v);
          }}
          scroll={false}
        />
        <TextField label={t('freelance.profile.title')} value={title} onChangeText={touch(setTitle)} maxLength={120} />
        <TextField label={t('freelance.profile.skills')} value={skills} onChangeText={touch(setSkills)} autoCapitalize="none" />
        <Text variant="small" muted>
          {t('freelance.profile.categories')}
        </Text>
        <Chips
          options={[{ value: 'all' as const, label: t('freelance.all') }, ...CATEGORY_VALUES.map((c) => ({ value: c, label: t(categoryKey(c)) }))]}
          value={category}
          onChange={(v) => {
            setSaved(false);
            setCategory(v);
          }}
        />
        <TextField label={t('freelance.profile.rate')} value={rate} onChangeText={touch(setRate)} keyboardType="decimal-pad" />
        <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} scroll={false} />
        <TextField label={t('freelance.profile.bio')} value={bio} onChangeText={touch(setBio)} multiline maxLength={1000} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {saved ? <Text variant="small">{t('freelance.profile.saved')}</Text> : null}
        <Button label={t('freelance.profile.save')} loading={save.isPending} disabled={title.trim().length < 3} onPress={() => save.mutate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  note: { borderRadius: radius.md, padding: spacing.md },
});
