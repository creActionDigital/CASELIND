import type { BookingDetail } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { Card, Chips, Loading, SectionTitle } from '../../../seller/ui';
import { parseDecimalToMinor } from '../../../seller/money';
import { bookingAction, fetchBooking, fetchOffer, proposeQuote, reviewBooking, svcKeys, type BookingAction } from '../../../services/api';
import { canReview, clientActions, deviceUtcOffset, formatWhen, providerActions, sortEvents } from '../../../services/logic';
import { BookingStatusBadge, bookingAmount, svcErrorMessage } from '../../../services/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, ErrorState, Text, TextField } from '../../../ui';

/** Détail d'une réservation : frise, devis, annulation dans le délai, actions du prestataire, avis. */
export default function BookingScreen() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const booking = useQuery({ queryKey: svcKeys.booking(id), queryFn: () => fetchBooking(id) });
  const offer = useQuery({
    queryKey: svcKeys.offer(booking.data?.offerId ?? ''),
    queryFn: () => fetchOffer(booking.data!.offerId),
    enabled: !!booking.data,
    retry: false,
  });

  const afterChange = (b: BookingDetail) => {
    qc.setQueryData(svcKeys.booking(id), b);
    void qc.invalidateQueries({ queryKey: ['services', 'bookings'] });
    void qc.invalidateQueries({ queryKey: ['services', 'received'] });
    setCancelling(false);
    setQuoting(false);
    setReason('');
  };
  const act = useMutation({
    mutationFn: ({ action, why }: { action: BookingAction; why?: string }) => bookingAction(id, action, why),
    onMutate: () => setError(null),
    onSuccess: afterChange,
    onError: (e) => {
      setError(svcErrorMessage(e, t, locale));
      void qc.invalidateQueries({ queryKey: svcKeys.booking(id) });
    },
  });
  const quote = useMutation({
    mutationFn: (minor: number) => proposeQuote(id, minor, currency),
    onMutate: () => setError(null),
    onSuccess: afterChange,
    onError: (e) => setError(svcErrorMessage(e, t, locale)),
  });
  const review = useMutation({
    mutationFn: () => reviewBooking(id, { rating, body: comment.trim() || undefined }),
    onMutate: () => setError(null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: svcKeys.booking(id) });
      void qc.invalidateQueries({ queryKey: svcKeys.reviews(booking.data?.offerId ?? '') });
    },
    onError: (e) => setError(svcErrorMessage(e, t, locale)),
  });

  const title = <Stack.Screen options={{ title: t('bookings.detail') }} />;
  if (booking.isPending) return <>{title}<Loading /></>;
  if (booking.isError) return <>{title}<ErrorState error={booking.error} onRetry={() => booking.refetch()} /></>;

  const b = booking.data;
  const now = new Date();
  const offset = offer.data?.utcOffsetMinutes ?? deviceUtcOffset();
  const isClient = b.client.userId === me?.id;
  const ca = clientActions(b, now);
  const pa = providerActions(b, now);
  const amountText = bookingAmount(b, locale);
  const busy = act.isPending || quote.isPending;
  const deadlineText = ca.cancel.deadline ? formatWhen(ca.cancel.deadline.toISOString(), offset, locale) : '';
  const events = sortEvents(b.events);

  const run = (action: BookingAction, why?: string) => act.mutate({ action, why });

  return (
    <>
      {title}
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        <View style={styles.between}>
          <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
            {b.offerTitle}
          </Text>
          <BookingStatusBadge status={b.status} />
        </View>
        <Text variant="small" muted>
          {isClient ? `${t('bookings.provider')} : ${b.provider.name}` : `${t('bookings.client')} : ${b.client.displayName} (@${b.client.handle})`}
        </Text>

        <Card>
          <Text variant="small" muted>
            {t('bookings.when')}
          </Text>
          <Text variant="bodyStrong">{formatWhen(b.startsAt, offset, locale)}</Text>
          <Text variant="small" muted style={{ marginTop: spacing.sm }}>
            {t('bookings.price')}
          </Text>
          <Text variant="bodyStrong">
            {b.priceKind === 'fixed' && amountText
              ? t('bookings.price.onSite', { amount: amountText })
              : b.quoteStatus === 'accepted' && amountText
                ? t('bookings.price.onSite', { amount: amountText })
                : t('services.price.quote')}
          </Text>
          {b.note ? (
            <>
              <Text variant="small" muted style={{ marginTop: spacing.sm }}>
                {t('bookings.note')}
              </Text>
              <Text>{b.note}</Text>
            </>
          ) : null}
        </Card>

        {/* Devis */}
        {b.priceKind === 'quote' ? (
          <Card>
            <Text variant="bodyStrong">{t('bookings.quote.title')}</Text>
            <Text variant="small" muted>
              {b.quoteStatus === 'none'
                ? t('bookings.quote.none')
                : b.quoteStatus === 'declined'
                  ? t('bookings.quote.declined')
                  : t(b.quoteStatus === 'proposed' ? 'bookings.quote.proposed' : 'bookings.quote.accepted', { amount: amountText ?? '' })}
            </Text>
            {isClient && ca.acceptQuote ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <Button label={t('bookings.quote.accept')} loading={act.isPending && act.variables?.action === 'quote/accept'} disabled={busy} onPress={() => run('quote/accept')} />
                <Button variant="danger" label={t('bookings.quote.decline')} disabled={busy} onPress={() => run('quote/decline')} />
                <Text variant="caption" muted>
                  {t('bookings.quote.declineWarn')}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {/* Client : annulation dans le délai */}
        {isClient && ca.cancel.ok ? (
          <>
            <Text variant="small" muted>
              {t('bookings.cancel.deadline', { when: deadlineText })}
            </Text>
            {cancelling ? (
              <Card>
                <TextField label={t('bookings.cancel.reason')} value={reason} onChangeText={setReason} maxLength={300} />
                <Button variant="danger" label={t('bookings.cancel.confirm')} loading={act.isPending} disabled={busy} onPress={() => run('cancel', reason.trim() || undefined)} />
                <Button variant="ghost" label={t('common.cancel')} onPress={() => setCancelling(false)} />
              </Card>
            ) : (
              <Button variant="secondary" label={t('bookings.cancel')} onPress={() => setCancelling(true)} />
            )}
          </>
        ) : null}
        {isClient && !ca.cancel.ok && ca.cancel.reason === 'window' ? (
          <Text variant="small" color={colors.danger}>
            {t('bookings.cancel.closed', { when: deadlineText })}
          </Text>
        ) : null}

        {/* Prestataire */}
        {!isClient ? (
          <View style={{ gap: spacing.sm }}>
            {pa.needsQuote ? <Text variant="small" muted>{t('bookings.recv.needQuote')}</Text> : null}
            {pa.waitingQuote ? <Text variant="small" muted>{t('bookings.recv.quoteWait')}</Text> : null}
            {pa.waitingStart ? <Text variant="small" muted>{t('bookings.recv.afterStart')}</Text> : null}
            {pa.confirm ? <Button label={t('bookings.recv.confirm')} loading={act.isPending && act.variables?.action === 'confirm'} disabled={busy} onPress={() => run('confirm')} /> : null}
            {pa.proposeQuote && !quoting ? <Button variant="secondary" label={t('bookings.recv.quote')} onPress={() => setQuoting(true)} /> : null}
            {pa.proposeQuote && quoting ? (
              <Card>
                <TextField label={t('bookings.recv.quoteAmount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
                <Chips options={[{ value: 'USD', label: 'USD' }, { value: 'CDF', label: 'CDF' }]} value={currency} onChange={setCurrency} scroll={false} />
                <Button
                  label={t('bookings.recv.quoteSend')}
                  loading={quote.isPending}
                  disabled={busy || parseDecimalToMinor(amount, currency) === null}
                  onPress={() => quote.mutate(parseDecimalToMinor(amount, currency)!)}
                />
                <Button variant="ghost" label={t('common.cancel')} onPress={() => setQuoting(false)} />
              </Card>
            ) : null}
            {pa.complete ? <Button label={t('bookings.recv.complete')} loading={act.isPending && act.variables?.action === 'complete'} disabled={busy} onPress={() => run('complete')} /> : null}
            {pa.noShow ? <Button variant="secondary" label={t('bookings.recv.noShow')} disabled={busy} onPress={() => run('no-show')} /> : null}
            {pa.decline ? <Button variant="secondary" label={t('bookings.recv.decline')} disabled={busy} onPress={() => run('decline')} /> : null}
            {pa.cancel && !pa.decline ? <Button variant="danger" label={t('bookings.cancel')} disabled={busy} onPress={() => run('cancel')} /> : null}
          </View>
        ) : null}

        {/* Avis après réalisation */}
        {isClient && canReview(b) ? (
          <Card>
            <Text variant="bodyStrong">{t('bookings.review.title')}</Text>
            <View style={styles.stars} accessibilityLabel={t('bookings.review.rating')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={t('bookings.review.stars', { n })}
                  accessibilityState={{ selected: rating === n }}
                  onPress={() => setRating(n)}
                  style={styles.star}
                >
                  <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={30} color={colors.primary} />
                </Pressable>
              ))}
            </View>
            <TextField label={t('bookings.review.body')} value={comment} onChangeText={setComment} multiline maxLength={2000} />
            <Button label={t('bookings.review.send')} loading={review.isPending} disabled={rating === 0 || review.isPending} onPress={() => review.mutate()} />
          </Card>
        ) : null}
        {b.reviewId ? (
          <Text variant="small" color={colors.success}>
            {t('bookings.review.done')}
          </Text>
        ) : null}

        <Button variant="ghost" label={t('bookings.openOffer')} onPress={() => router.push({ pathname: '/services/[id]', params: { id: b.offerId } })} />

        <SectionTitle>{t('bookings.timeline')}</SectionTitle>
        {events.length === 0 ? (
          <TimelineRow label={t('bookings.timeline.created')} at={formatWhen(b.createdAt, offset, locale)} first last />
        ) : (
          events.map((ev, i) => (
            <TimelineRow
              key={`${ev.createdAt}-${i}`}
              label={t(`bookings.status.${ev.status}` as MessageKey)}
              detail={`${t(`bookings.actor.${ev.actorKind}` as MessageKey)}${ev.note ? ` · ${ev.note}` : ''}`}
              at={formatWhen(ev.createdAt, offset, locale)}
              first={i === 0}
              last={i === events.length - 1}
            />
          ))
        )}
      </ScrollView>
    </>
  );
}

function TimelineRow({ label, detail, at, first, last }: { label: string; detail?: string; at: string; first?: boolean; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.tl} accessible accessibilityLabel={`${label}, ${at}${detail ? `, ${detail}` : ''}`}>
      <View style={styles.rail}>
        <View style={[styles.line, { backgroundColor: first ? 'transparent' : colors.border }]} />
        <View style={[styles.dot, { backgroundColor: last ? colors.primary : colors.border }]} />
        <View style={[styles.line, { backgroundColor: last ? 'transparent' : colors.border }]} />
      </View>
      <View style={{ flex: 1, paddingVertical: spacing.sm }}>
        <Text variant="bodyStrong">{label}</Text>
        {detail ? (
          <Text variant="small" muted>
            {detail}
          </Text>
        ) : null}
        <Text variant="caption" muted>
          {at}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  stars: { flexDirection: 'row', gap: spacing.xs, marginVertical: spacing.sm },
  star: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tl: { flexDirection: 'row', gap: spacing.md },
  rail: { width: 14, alignItems: 'center' },
  line: { flex: 1, width: 2 },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
