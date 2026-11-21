import type { ContractType } from '@caselind/contracts';
import { safeBack } from '../../../../../lib/back-target';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../../../i18n';
import { ApiRequestError } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { createOrgJob, fetchJob, jobKeys, updateOrgJob } from '../../../../../jobs/api';
import { CONTRACT_TYPES, contractKey } from '../../../../../jobs/logic';
import { minorToDecimalString } from '../../../../../seller/money';
import { Chips } from '../../../../../seller/ui';
import { spacing } from '../../../../../theme/tokens';
import { useTheme } from '../../../../../theme/use-theme';
import { parseWalletAmount, WALLET_CURRENCIES } from '../../../../../wallet/amount';
import { Button, Screen, Text, TextField } from '../../../../../ui';

/** Publier ou modifier (paramètre `jobId`) une offre : poste, description, ville, contrat, salaire facultatif. */
export default function NewJob() {
  const { orgId, jobId } = useLocalSearchParams<{ orgId: string; jobId?: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('Goma');
  const [contract, setContract] = useState<ContractType>('full_time');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [error, setError] = useState<string | null>(null);

  const existing = useQuery({ queryKey: jobKeys.one(String(jobId)), queryFn: () => fetchJob(String(jobId)), enabled: !!jobId });
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    const j = existing.data;
    if (!j || prefilled) return; // fill once: a background refetch must not wipe what the recruiter is typing
    setPrefilled(true);
    setTitle(j.title);
    setDescription(j.description);
    setCity(j.city);
    setContract(j.contractType);
    if (j.salary) {
      setCurrency(j.salary.currency);
      setMin(j.salary.minMinor === null ? '' : minorToDecimalString(j.salary.minMinor, j.salary.currency));
      setMax(j.salary.maxMinor === null ? '' : minorToDecimalString(j.salary.maxMinor, j.salary.currency));
    }
  }, [existing.data, prefilled]);

  const publish = useMutation({
    mutationFn: () => {
      const parse = (v: string) => {
        if (!v.trim()) return null;
        const p = parseWalletAmount(v, currency);
        if ('issue' in p) throw new Error('invalid_amount');
        return p.minor;
      };
      const salaryMinMinor = parse(min);
      const salaryMaxMinor = parse(max);
      const body = {
        title: title.trim(),
        description: description.trim(),
        city: city.trim(),
        contractType: contract,
        salaryMinMinor,
        salaryMaxMinor,
        currency: salaryMinMinor === null && salaryMaxMinor === null ? null : currency,
      };
      return jobId ? updateOrgJob(String(orgId), String(jobId), body) : createOrgJob(String(orgId), body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobKeys.all });
      safeBack(router, `/seller/${orgId}/jobs`);
    },
    onError: (e) => {
      if ((e instanceof Error && e.message === 'invalid_amount') || (e instanceof ApiRequestError && e.status === 400)) return setError(t('jobs.err.invalid'));
      setError(errorMessage(e, t, locale));
    },
  });

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: jobId ? t('jobs.org.edit') : t('jobs.org.new') }} />
      <View style={styles.form}>
        <TextField label={t('jobs.org.field.title')} value={title} onChangeText={setTitle} maxLength={120} />
        <TextField label={t('jobs.org.field.description')} value={description} onChangeText={setDescription} multiline maxLength={4000} />
        <TextField label={t('jobs.org.field.city')} value={city} onChangeText={setCity} maxLength={80} />
        <Chips options={CONTRACT_TYPES.map((c) => ({ value: c, label: t(contractKey(c)) }))} value={contract} onChange={setContract} />
        <TextField label={t('jobs.org.field.salaryMin')} value={min} onChangeText={setMin} keyboardType="decimal-pad" />
        <TextField label={t('jobs.org.field.salaryMax')} value={max} onChangeText={setMax} keyboardType="decimal-pad" />
        <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} scroll={false} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={jobId ? t('jobs.org.save') : t('jobs.org.publish')} loading={publish.isPending} disabled={title.trim().length < 3 || city.trim().length < 2 || (!!jobId && !existing.data)} onPress={() => publish.mutate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: spacing.md } });
