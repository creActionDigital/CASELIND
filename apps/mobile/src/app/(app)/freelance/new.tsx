import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { createMission, frKeys } from '../../../freelance/api';
import { freelanceErrorKey } from '../../../freelance/logic';
import { Chips } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { parseWalletAmount, WALLET_CURRENCIES } from '../../../wallet/amount';
import { Button, Screen, Text, TextField } from '../../../ui';

/** Publier une mission : titre, description, budget, échéance facultative. */
export default function NewMission() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () => {
      const p = parseWalletAmount(budget, currency);
      if ('issue' in p || p.minor <= 0) throw new Error('invalid');
      return createMission({ title: title.trim(), description: description.trim(), budgetMinor: p.minor, currency, deadline: deadline.trim() || null });
    },
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: frKeys.all });
      router.replace({ pathname: '/freelance/[id]', params: { id: m.id } });
    },
    onError: (e) => {
      const key = freelanceErrorKey(e);
      if (key) return setError(t(key));
      if ((e instanceof Error && e.message === 'invalid') || (e instanceof ApiRequestError && e.status === 400)) return setError(t('freelance.err.invalid'));
      setError(errorMessage(e, t, locale));
    },
  });

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('freelance.new') }} />
      <View style={styles.form}>
        <TextField label={t('freelance.field.title')} value={title} onChangeText={setTitle} maxLength={120} />
        <TextField label={t('freelance.field.description')} value={description} onChangeText={setDescription} multiline maxLength={4000} />
        <TextField label={t('freelance.field.budget')} value={budget} onChangeText={setBudget} keyboardType="decimal-pad" />
        <Chips options={WALLET_CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={setCurrency} scroll={false} />
        <TextField label={t('freelance.field.deadline')} value={deadline} onChangeText={setDeadline} autoCapitalize="none" maxLength={10} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('freelance.publish')} loading={publish.isPending} disabled={title.trim().length < 3 || !budget.trim()} onPress={() => publish.mutate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: spacing.md } });
