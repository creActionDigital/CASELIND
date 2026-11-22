import { PersonField } from '../../../components/PersonField';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../../i18n';
import { fetchContacts, rideKeys, saveContacts } from '../../../mobility/api';
import { mobilityErrorMessage } from '../../../mobility/errors';
import { Card, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Screen, Text, TextField } from '../../../ui';

const MAX_CONTACTS = 3;

/** Contacts de confiance (3 au plus), prévenus par une notification lors d'une alerte pendant une course. */
export default function TrustedContacts() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: rideKeys.contacts, queryFn: fetchContacts, retry: false });
  const [handles, setHandles] = useState<string[] | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.data && handles === null) setHandles(q.data.items.map((c) => c.handle));
  }, [q.data, handles]);

  const save = useMutation({
    mutationFn: (h: string[]) => saveContacts(h),
    onMutate: () => {
      setError(null);
      setInfo(null);
    },
    onSuccess: (r) => {
      qc.setQueryData(rideKeys.contacts, r);
      setHandles(r.items.map((c) => c.handle));
      setInfo(t('mobility.contacts.saved'));
    },
    onError: (e) => setError(mobilityErrorMessage(e, t, locale)),
  });

  if (q.isPending || handles === null) return q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Loading />;

  function add(handle: string) {
    const h = handle;
    if (!h || handles!.some((x) => x.toLowerCase() === h.toLowerCase())) return;
    if (handles!.length >= MAX_CONTACTS) return setError(t('mobility.contacts.limit'));
    setHandles([...handles!, h]);
    setError(null);
    setInfo(null);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mobility.contacts.title') }} />
      <Text muted style={{ marginBottom: spacing.sm }}>{t('mobility.contacts.intro')}</Text>
      {handles.length === 0 ? (
        <Text muted style={{ marginBottom: spacing.lg }}>{t('mobility.contacts.empty')}</Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {handles.map((h) => (
            <Card key={h} style={{ gap: spacing.xs }}>
              <Text variant="bodyStrong">@{h}</Text>
              <Button
                variant="ghost"
                label={t('mobility.contacts.remove', { name: `@${h}` })}
                onPress={() => {
                  setHandles(handles.filter((x) => x !== h));
                  setInfo(null);
                }}
              />
            </Card>
          ))}
        </View>
      )}
      {handles.length < MAX_CONTACTS ? (
        <>
          <PersonField value={null} placeholder={t('mobility.contacts.add')} exclude={handles} onChange={(x) => x && add(x.handle)} />
        </>
      ) : (
        <Text variant="small" muted>
          {t('mobility.contacts.limit')}
        </Text>
      )}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {info ? (
        <Text variant="small" accessibilityLiveRegion="polite">
          {info}
        </Text>
      ) : null}
      <Button label={t('mobility.contacts.save')} loading={save.isPending} onPress={() => save.mutate(handles)} />
    </Screen>
  );
}
