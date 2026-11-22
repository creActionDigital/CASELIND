import type { ListingOffer } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { mergeDeepItem } from '../../../lib/deep-item';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { answerOffer, fetchOffer, fetchOffers, listingKeys } from '../../../listings/api';
import { offerErrorKey } from '../../../listings/logic';
import { ContactSeller } from '../../../shop/ContactSeller';
import { formatMoney, parseMajorToMinor } from '../../../shop/format';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

type Action = 'accept' | 'decline' | 'counter' | 'cancel';

/** Mes offres : négociations envoyées et reçues. Le vendeur accepte, refuse ou fait une seule contre-offre ; l'acheteur répond à la contre-offre ou annule. Accord indicatif, aucun paiement. */
export default function Offers() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: listingKeys.offers, queryFn: fetchOffers });
  const { id: deepId } = useLocalSearchParams<{ id?: string }>();
  const one = useQuery({ queryKey: [...listingKeys.offers, deepId], queryFn: () => fetchOffer(deepId!), enabled: !!deepId });
  const offers = list.data ? mergeDeepItem(list.data.items, one.data) : [];
  const [counters, setCounters] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (a: { o: ListingOffer; action: Action; amountMinor?: number }) => answerOffer(a.o.id, a.action, a.amountMinor),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: listingKeys.offers });
    },
    onError: (e) => {
      const key = e instanceof ApiRequestError ? offerErrorKey(e.details) : null;
      setError(key ? t(key) : errorMessage(e, t, locale));
    },
  });
  const counter = (o: ListingOffer) => {
    const amountMinor = parseMajorToMinor(counters[o.id] ?? '', o.currency, locale);
    if (amountMinor === null) setError(t('listings.offer.err.amount'));
    else act.mutate({ o, action: 'counter', amountMinor });
  };

  if (list.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (list.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      </Screen>
    );
  }
  const busy = (o: ListingOffer, action: Action) => act.isPending && act.variables?.o.id === o.id && act.variables.action === action;
  const money = (minor: number, o: ListingOffer) => formatMoney(minor, o.currency, locale);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('listings.offer.mine') }} />
      <View style={styles.list}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text variant="small" muted>
            {t('listings.offer.safety')}
          </Text>
        </View>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {offers.length === 0 ? <Text muted>{t('listings.offer.empty')}</Text> : null}
        {offers.map((o) => {
          const myTurn = o.role === 'owner' ? o.status === 'offered' : o.status === 'countered';
          return (
            <View key={o.id} style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text variant="heading">{o.listingTitle}</Text>
              <Text muted>{t(o.role === 'owner' ? 'listings.offer.receivedFrom' : 'listings.offer.sentTo', { name: o.other.displayName })}</Text>
              {o.askingMinor !== null ? (
                <Text variant="small" muted>
                  {t('listings.offer.asking', { price: money(o.askingMinor, o) })}
                </Text>
              ) : null}
              <Text variant="bodyStrong">{t('listings.offer.offered', { price: money(o.offerMinor, o) })}</Text>
              {o.counterMinor !== null ? <Text variant="bodyStrong">{t('listings.offer.countered', { price: money(o.counterMinor, o) })}</Text> : null}
              <View style={{ alignSelf: 'flex-start' }}><Badge tone={o.status === 'accepted' ? 'primary' : 'neutral'} label={t(`listings.offer.status.${o.status}` as 'listings.offer.status.offered')} /></View>
              {o.message ? <Text>{o.message}</Text> : null}
              {myTurn ? (
                <>
                  <Button label={t('listings.offer.accept')} loading={busy(o, 'accept')} onPress={() => act.mutate({ o, action: 'accept' })} />
                  {o.role === 'owner' ? (
                    <>
                      <TextField label={t('listings.offer.counterAmount')} value={counters[o.id] ?? ''} onChangeText={(x) => setCounters({ ...counters, [o.id]: x })} keyboardType="decimal-pad" />
                      <Button variant="secondary" label={t('listings.offer.counter')} loading={busy(o, 'counter')} onPress={() => counter(o)} />
                    </>
                  ) : null}
                  <Button variant="secondary" label={t('listings.offer.decline')} loading={busy(o, 'decline')} onPress={() => act.mutate({ o, action: 'decline' })} />
                </>
              ) : null}
              {o.role === 'buyer' && (o.status === 'offered' || o.status === 'countered') ? (
                <Button variant="ghost" label={t('listings.offer.cancel')} loading={busy(o, 'cancel')} onPress={() => act.mutate({ o, action: 'cancel' })} />
              ) : null}
              {o.status === 'accepted' ? <ContactSeller contactUserId={o.other.id} labelKey="listings.offer.contact" /> : null}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { borderRadius: radius.md, gap: spacing.sm, padding: spacing.md },
});
