import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { ApiRequestError } from '../../../lib/api';
import { closeListing, fetchListing, listingKeys, makeOffer, requestVisit } from '../../../listings/api';
import { toggleCompareId, useCompareIds } from '../../../listings/compare-store';
import { kindKey, offerBounds, offerErrorKey, parseVisitTime, priceLabel, vehicleRows, visitErrorKey } from '../../../listings/logic';
import { formatMoney, parseMajorToMinor } from '../../../shop/format';
import { createDirect, startChatErrorKey } from '../../../messaging/api';
import { openReport } from '../../../report/open-report';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Badge, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

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
  const [visitOpen, setVisitOpen] = useState(false);
  const [vDate, setVDate] = useState('');
  const [vTime, setVTime] = useState('');
  const [vMsg, setVMsg] = useState('');
  const [visitInfo, setVisitInfo] = useState<string | null>(null);
  const visit = useMutation({
    mutationFn: (scheduledAt: string) => requestVisit(String(id), { scheduledAt, message: vMsg.trim() }),
    onSuccess: () => {
      setVisitOpen(false);
      setVisitInfo(t('listings.visit.sent'));
      setError(null);
    },
    onError: (e) => {
      const key = e instanceof ApiRequestError ? visitErrorKey(e.details) : null;
      setError(key ? t(key) : errorMessage(e, t, locale));
    },
  });
  const sendVisit = () => {
    const at = parseVisitTime(vDate, vTime);
    if (!at) setError(t('listings.visit.err.date'));
    else visit.mutate(at);
  };
  const [offerOpen, setOfferOpen] = useState(false);
  const [oAmount, setOAmount] = useState('');
  const [oMsg, setOMsg] = useState('');
  const compareIds = useCompareIds();
  const offer = useMutation({
    mutationFn: (amountMinor: number) => makeOffer(String(id), { amountMinor, message: oMsg.trim() }),
    onSuccess: () => {
      setOfferOpen(false);
      setVisitInfo(t('listings.offer.sent'));
      setError(null);
      void qc.invalidateQueries({ queryKey: listingKeys.offers });
    },
    onError: (e) => {
      const key = e instanceof ApiRequestError ? offerErrorKey(e.details) : null;
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
        {vehicleRows(l, t as (k: MessageKey) => string).map(([k, v]) => (
          <Text key={k}>
            {t(k)} : {v}
          </Text>
        ))}
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
            {l.status === 'active' ? <Button variant="secondary" label={t('listings.visit.ask')} onPress={() => setVisitOpen(!visitOpen)} /> : null}
            {l.status === 'active' && l.priceMinor !== null && l.currency !== null ? (
              <Button variant="secondary" label={t('listings.offer.ask')} onPress={() => setOfferOpen(!offerOpen)} />
            ) : null}
            {offerOpen && l.priceMinor !== null && l.currency !== null ? (
              <View style={styles.body}>
                <Text variant="small" muted>
                  {t('listings.offer.safety')}
                </Text>
                <TextField
                  label={t('listings.offer.amount', { min: formatMoney(offerBounds(l.priceMinor).min, l.currency, locale), max: formatMoney(l.priceMinor, l.currency, locale) })}
                  value={oAmount}
                  onChangeText={setOAmount}
                  keyboardType="decimal-pad"
                />
                <TextField label={t('listings.offer.message')} value={oMsg} onChangeText={setOMsg} maxLength={300} multiline />
                <Button
                  label={t('listings.offer.send')}
                  loading={offer.isPending}
                  onPress={() => {
                    const m = parseMajorToMinor(oAmount, l.currency!, locale);
                    if (m === null) setError(t('listings.offer.err.amount'));
                    else offer.mutate(m);
                  }}
                />
              </View>
            ) : null}
            {visitOpen ? (
              <View style={styles.body}>
                <Text variant="small" muted>
                  {t('listings.visit.safety')}
                </Text>
                <TextField label={t('listings.visit.date')} value={vDate} onChangeText={setVDate} maxLength={10} autoCapitalize="none" />
                <TextField label={t('listings.visit.time')} value={vTime} onChangeText={setVTime} maxLength={5} autoCapitalize="none" />
                <TextField label={t('listings.visit.message')} value={vMsg} onChangeText={setVMsg} maxLength={300} multiline />
                <Button label={t('listings.visit.send')} loading={visit.isPending} onPress={sendVisit} />
              </View>
            ) : null}
            {visitInfo ? (
              <Text variant="small" accessibilityLiveRegion="polite">
                {visitInfo}
              </Text>
            ) : null}
            {l.kind === 'vehicle' && l.status === 'active' ? (
              <>
                <Button variant="secondary" label={t(compareIds.includes(l.id) ? 'listings.compare.remove' : 'listings.compare.add')} onPress={() => toggleCompareId(l.id)} />
                {compareIds.length > 0 ? <Button variant="ghost" label={t('listings.compare.open', { n: compareIds.length })} onPress={() => router.push('/listings/compare')} /> : null}
              </>
            ) : null}
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
