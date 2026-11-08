import type { ServiceReview } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SheetModal } from '../../../components/SheetModal';
import { useAuth } from '../../../auth/auth-context';
import { useI18n } from '../../../i18n';
import { openReport } from '../../../report/open-report';
import { Card, Chips, Loading, SectionTitle } from '../../../seller/ui';
import { createBooking, fetchOffer, fetchServiceReviews, fetchSlots, svcKeys } from '../../../services/api';
import { dayLabel, formatOffset, formatWhen, groupSlotsByDay, slotsWindow } from '../../../services/logic';
import { priceLabel, RatingLine, svcErrorMessage, VerifiedBadge } from '../../../services/ui';
import { Stars } from '../../../shop/parts';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Badge, Button, ErrorState, IconButton, Text, TextField } from '../../../ui';

/** Fiche d'une offre : photos, description, zone, annulation, avis, créneaux et réservation. */
export default function ServiceOffer() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [menu, setMenu] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const offer = useQuery({ queryKey: svcKeys.offer(id), queryFn: () => fetchOffer(id) });
  const slots = useQuery({
    queryKey: svcKeys.slots(id),
    queryFn: () => {
      const w = slotsWindow(new Date());
      return fetchSlots(id, w.from, w.to);
    },
    enabled: offer.isSuccess,
  });
  const reviews = useInfiniteQuery({
    queryKey: svcKeys.reviews(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchServiceReviews(id, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: offer.isSuccess,
  });

  const offset = offer.data?.utcOffsetMinutes ?? 0;
  const days = useMemo(() => groupSlotsByDay(slots.data?.items ?? [], offset), [slots.data, offset]);
  const activeDay = days.find((d) => d.day === day) ?? days[0];

  const book = useMutation({
    mutationFn: () => createBooking(id, { startsAt: picked!, note: note.trim() || undefined }),
    onMutate: () => setError(null),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: svcKeys.myBookings });
      void qc.invalidateQueries({ queryKey: svcKeys.slots(id) });
      router.replace({ pathname: '/bookings/[id]', params: { id: b.id } });
    },
    onError: (e) => {
      setError(svcErrorMessage(e, t, locale));
      setPicked(null);
      void qc.invalidateQueries({ queryKey: svcKeys.slots(id) });
    },
  });

  const title = (
    <Stack.Screen
      options={{
        title: t('services.offer.title'),
        headerRight: () => <IconButton icon="ellipsis-horizontal" label={t('services.menu')} onPress={() => setMenu(true)} />,
      }}
    />
  );
  if (offer.isPending) return <>{title}<Loading /></>;
  if (offer.isError) return <>{title}<ErrorState error={offer.error} onRetry={() => offer.refetch()} /></>;
  const o = offer.data;
  const own = o.provider.userId !== null && o.provider.userId === me?.id;
  const summary = reviews.data?.pages[0]?.summary;
  const reviewItems = (reviews.data?.pages ?? []).flatMap((p) => p.items);
  const isQuote = o.priceKind === 'quote';

  return (
    <>
      {title}
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        {o.media.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {o.media.map((m, i) => (
              <View key={m.id} style={[styles.photo, { backgroundColor: colors.surfaceAlt }]}>
                <AuthImage contentUrl={m.contentUrl} label={t('services.offer.photo', { n: i + 1 })} style={StyleSheet.absoluteFill} />
              </View>
            ))}
          </ScrollView>
        ) : null}

        <Text variant="title" accessibilityRole="header">
          {o.title}
        </Text>
        <View style={styles.row}>
          <Text variant="heading" color={colors.primary}>
            {priceLabel(o, t, locale)}
          </Text>
          <Text variant="small" muted>
            · {t('services.duration', { n: o.durationMin })}
          </Text>
        </View>
        <RatingLine average={o.averageRating} count={o.ratingCount} />
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <Text variant="small" muted>
            {o.provider.name}
          </Text>
          <VerifiedBadge verified={o.provider.verified} />
          {o.urgentAvailable ? <Badge tone="accent" label={t('services.urgent')} /> : null}
        </View>
        {o.guaranteeNote ? (
          <View style={[styles.note, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
            <Text variant="small" style={{ flex: 1 }}>
              {t('services.guarantee', { note: o.guaranteeNote })}
            </Text>
          </View>
        ) : null}

        {o.description ? (
          <>
            <SectionTitle>{t('services.offer.about')}</SectionTitle>
            <Text>{o.description}</Text>
          </>
        ) : null}

        <SectionTitle>{t('services.offer.zone')}</SectionTitle>
        <Text>{t('services.offer.zoneValue', { city: o.city, n: o.radiusKm })}</Text>
        {o.inServiceZone === false ? (
          <Text variant="small" color={colors.danger}>
            {t('services.outOfZone')}
          </Text>
        ) : null}

        <SectionTitle>{t('services.offer.cancel')}</SectionTitle>
        <Text>{o.cancelNoticeHours > 0 ? t('services.offer.cancelNotice', { n: o.cancelNoticeHours }) : t('services.offer.cancelAnytime')}</Text>

        <Card style={{ marginTop: spacing.md }}>
          <View style={styles.row}>
            <Ionicons name="cash-outline" size={22} color={colors.primary} />
            <Text variant="bodyStrong">{t('services.onSite.title')}</Text>
          </View>
          <Text variant="small" muted>
            {t('services.onSite.body')}
          </Text>
        </Card>

        <SectionTitle>{t('services.slots.title')}</SectionTitle>
        {own ? (
          <Text muted>{t('services.offer.own')}</Text>
        ) : slots.isPending ? (
          <Loading />
        ) : slots.isError ? (
          <ErrorState error={slots.error} onRetry={() => slots.refetch()} />
        ) : days.length === 0 ? (
          <Text muted>{t('services.slots.none')}</Text>
        ) : (
          <>
            <Chips
              options={days.map((d) => ({ value: d.day, label: dayLabel(d.day, locale) }))}
              value={activeDay?.day ?? null}
              onChange={(d) => {
                setDay(d);
                setPicked(null);
              }}
            />
            <View style={styles.slotWrap}>
              {activeDay?.slots.map((s) => {
                const on = picked === s.startsAt;
                return (
                  <Pressable
                    key={s.startsAt}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={formatWhen(s.startsAt, offset, locale)}
                    onPress={() => setPicked(on ? null : s.startsAt)}
                    style={[styles.slot, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}
                  >
                    <Text variant="small" color={on ? colors.onPrimary : colors.text} style={{ fontWeight: '600' }}>
                      {s.time}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text variant="caption" muted>
              {t('services.slots.tz', { offset: formatOffset(offset) })}
            </Text>
            {picked ? (
              <Text variant="small" accessibilityLiveRegion="polite">
                {t('services.slots.picked', { when: formatWhen(picked, offset, locale) })}
              </Text>
            ) : null}
            <TextField label={t('services.note')} value={note} onChangeText={setNote} multiline maxLength={500} />
            {error ? (
              <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <Button
              label={isQuote ? t('services.book.quote') : t('services.book')}
              loading={book.isPending}
              disabled={!picked || book.isPending}
              onPress={() => book.mutate()}
            />
            {!picked ? (
              <Text variant="caption" muted>
                {t('services.book.pick')}
              </Text>
            ) : null}
          </>
        )}

        <SectionTitle>{t('services.offer.reviews')}</SectionTitle>
        {summary && summary.ratingCount > 0 ? <RatingLine average={summary.averageRating} count={summary.ratingCount} /> : null}
        {reviews.isPending ? (
          <Loading />
        ) : reviewItems.length === 0 ? (
          <Text muted>{t('services.offer.reviewsEmpty')}</Text>
        ) : (
          reviewItems.map((r) => <ReviewRow key={r.id} review={r} />)
        )}
        {reviews.hasNextPage ? <Button variant="ghost" label={t('story.viewer.more')} loading={reviews.isFetchingNextPage} onPress={() => reviews.fetchNextPage()} /> : null}
      </ScrollView>

      <SheetModal visible={menu} onClose={() => setMenu(false)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('services.report.offer')}
          onPress={() => {
            setMenu(false);
            openReport({ targetType: 'service', targetId: id });
          }}
          style={styles.menuItem}
        >
          <Ionicons name="flag-outline" size={22} color={colors.danger} />
          <Text color={colors.danger}>{t('services.report.offer')}</Text>
        </Pressable>
      </SheetModal>
    </>
  );
}

function ReviewRow({ review }: { review: ServiceReview }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Card>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {review.author.displayName}
        </Text>
        <Stars value={review.rating} />
      </View>
      <Text variant="caption" muted>
        {t('services.offer.reviewVerified')}
      </Text>
      {review.body ? <Text>{review.body}</Text> : null}
      {review.reply ? (
        <View style={[styles.reply, { backgroundColor: colors.surfaceAlt }]}>
          <Text variant="caption" muted>
            {t('services.offer.reviewReply')}
          </Text>
          <Text variant="small">{review.reply.body}</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('services.report.review')}
        onPress={() => openReport({ targetType: 'service_review', targetId: review.id })}
        style={styles.link}
      >
        <Text variant="small" color={colors.textMuted}>
          {t('services.report')}
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  photo: { width: 260, height: 180, borderRadius: radius.md, overflow: 'hidden' },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: { minHeight: 44, minWidth: 72, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  menuItem: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  reply: { padding: spacing.md, borderRadius: radius.sm, gap: 2 },
  link: { minHeight: 44, justifyContent: 'center' },
});
