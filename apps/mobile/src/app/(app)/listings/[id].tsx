import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { closeListing, fetchListing, listingKeys } from '../../../listings/api';
import { kindKey, priceLabel } from '../../../listings/logic';
import { createDirect, startChatErrorKey } from '../../../messaging/api';
import { openReport } from '../../../report/open-report';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Badge, Button, ErrorState, Screen, Text } from '../../../ui';

/** Fiche d'annonce : photos, prix, ville, vendeur ; contact par la messagerie, signalement, clôture par le propriétaire. */
export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: listingKeys.one(String(id)), queryFn: () => fetchListing(String(id)) });

  const contact = useMutation({
    mutationFn: (ownerId: string) => createDirect(ownerId),
    onSuccess: (c) => router.push({ pathname: '/messages/[conversationId]', params: { conversationId: c.id } }),
    onError: (e) => {
      const key = startChatErrorKey(e);
      setError(key ? t(key) : errorMessage(e, t, locale));
    },
  });
  const close = useMutation({
    mutationFn: () => closeListing(String(id)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: listingKeys.all }),
    onError: (e) => setError(errorMessage(e, t, locale)),
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
  const l = q.data;
  const price = priceLabel(l, locale);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t(kindKey(l.kind)) }} />
      {l.mediaIds.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
          {l.mediaIds.map((m) => (
            <AuthImage key={m} contentUrl={`/v1/media/${m}/content`} label={l.title} style={styles.photo} />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.body}>
        <Text variant="title" accessibilityRole="header">
          {l.title}
        </Text>
        {price ? <Text variant="heading">{price}</Text> : null}
        <Text muted>
          {l.city} · {t('listings.by', { name: l.owner.displayName })}
        </Text>
        {l.status === 'closed' ? <Badge tone="neutral" label={t('listings.closed')} /> : null}
        {l.description ? <Text>{l.description}</Text> : null}
        <View style={[styles.safety, { backgroundColor: colors.surface }]}>
          <Text variant="small" muted>
            {t('listings.safety')}
          </Text>
        </View>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {l.mine ? (
          l.status === 'active' ? <Button variant="secondary" label={t('listings.close')} loading={close.isPending} onPress={() => close.mutate()} /> : null
        ) : (
          <>
            <Button label={t('listings.contact')} loading={contact.isPending} onPress={() => contact.mutate(l.owner.id)} />
            <Button variant="ghost" label={t('listings.report')} onPress={() => openReport({ targetType: 'listing', targetId: l.id })} />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photos: { gap: spacing.sm },
  photo: { width: 280, height: 210, borderRadius: radius.md },
  body: { gap: spacing.md, marginTop: spacing.md },
  safety: { borderRadius: radius.md, padding: spacing.md },
});
