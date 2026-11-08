import type { Booking, ServiceOffer } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../i18n';
import { ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDistance } from '../places/geo';
import { Card } from '../seller/ui';
import { formatMoney } from '../shop/format';
import { Stars } from '../shop/parts';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { AuthImage, Badge, Text } from '../ui';
import { formatWhen } from './logic';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

const KNOWN_ERRORS = new Set<string>([
  'services.error.slot_taken',
  'services.error.slot_unavailable',
  'services.error.own_service',
  'services.error.profile_required',
  'services.error.org_not_services',
  'services.error.not_a_quote_service',
  'services.error.quote_not_accepted',
  'services.error.not_started',
  'bookings.error.cancellation_window_closed',
  'bookings.error.invalid_transition',
  'bookings.error.booking_not_completed',
  'bookings.error.already_reviewed',
]);

/** Message localisé d'un refus de réservation (409/403 `details.reason` ou `code`), sinon l'erreur générique. */
export function svcErrorMessage(err: unknown, t: T, locale: string): string {
  if (err instanceof ApiRequestError) {
    const names = [err.detail<string>('reason'), err.code].filter((x): x is string => typeof x === 'string');
    for (const n of names) {
      for (const prefix of ['services.error.', 'bookings.error.']) {
        if (KNOWN_ERRORS.has(prefix + n)) return t((prefix + n) as MessageKey);
      }
    }
  }
  return errorMessage(err, t, locale);
}

export const priceLabel = (o: { priceKind: 'fixed' | 'quote'; priceMinor: number | null; currency: string | null }, t: T, locale: string): string =>
  o.priceKind === 'quote' || o.priceMinor === null || !o.currency ? t('services.price.quote') : formatMoney(o.priceMinor, o.currency, locale);

export function VerifiedBadge({ verified }: { verified: boolean }) {
  const { t } = useI18n();
  return <Badge tone={verified ? 'primary' : 'neutral'} label={verified ? t('services.verified') : t('services.unverified')} />;
}

export function RatingLine({ average, count }: { average: number | null; count: number }) {
  const { t, locale } = useI18n();
  if (!count || average === null) {
    return (
      <Text variant="small" muted>
        {t('services.noRating')}
      </Text>
    );
  }
  return (
    <View style={styles.row}>
      <Stars value={average} size={14} />
      <Text variant="small" muted>
        {t('services.rating', { avg: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(average), n: count })}
      </Text>
    </View>
  );
}

/** Carte d'une offre : photo, prestataire, prix, note, distance, badge « non vérifié ». */
export function OfferCard({ offer, onPress }: { offer: ServiceOffer; onPress: () => void }) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const cover = offer.media[0];
  const price = priceLabel(offer, t, locale);
  const distance = offer.distanceKm !== null ? formatDistance(offer.distanceKm, locale) : null;
  return (
    <Card
      onPress={onPress}
      label={`${offer.title}, ${offer.provider.name}, ${price}${distance ? `, ${distance}` : ''}, ${offer.provider.verified ? t('services.verified') : t('services.unverified')}`}
    >
      <View style={styles.row}>
        <View style={[styles.cover, { backgroundColor: colors.surfaceAlt }]}>
          {cover ? (
            <AuthImage contentUrl={cover.contentUrl} label={offer.title} style={StyleSheet.absoluteFill} />
          ) : (
            <Ionicons name="construct-outline" size={28} color={colors.textMuted} />
          )}
        </View>
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {offer.title}
          </Text>
          <Text variant="small" muted numberOfLines={1}>
            {offer.provider.name}
          </Text>
          <Text variant="bodyStrong" color={colors.primary}>
            {price}
          </Text>
          <RatingLine average={offer.averageRating} count={offer.ratingCount} />
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <VerifiedBadge verified={offer.provider.verified} />
            {distance ? (
              <Text variant="caption" muted>
                {distance}
              </Text>
            ) : null}
            {offer.inServiceZone === false ? (
              <Text variant="caption" color={colors.danger}>
                {t('services.outOfZone')}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Card>
  );
}

const STATUS_TONE: Record<Booking['status'], 'primary' | 'accent' | 'neutral'> = {
  requested: 'accent',
  confirmed: 'primary',
  completed: 'neutral',
  cancelled: 'neutral',
  declined: 'neutral',
  no_show: 'neutral',
};

export function BookingStatusBadge({ status }: { status: Booking['status'] }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]} label={t(`bookings.status.${status}` as MessageKey)} />;
}

/** Carte d'une réservation (liste client ou demandes reçues). `who` : nom de l'autre partie. */
export function BookingCard({ booking, offset, who, onPress }: { booking: Booking; offset: number; who: string; onPress: () => void }) {
  const { t, locale } = useI18n();
  const when = formatWhen(booking.startsAt, offset, locale);
  return (
    <Card onPress={onPress} label={`${booking.offerTitle}, ${when}, ${t(`bookings.status.${booking.status}` as MessageKey)}`}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
          {booking.offerTitle}
        </Text>
        <BookingStatusBadge status={booking.status} />
      </View>
      <Text variant="small" muted numberOfLines={1}>
        {who}
      </Text>
      <Text variant="small">{when}</Text>
    </Card>
  );
}

export const bookingAmount = (b: Pick<Booking, 'amountMinor' | 'currency'>, locale: string): string | null =>
  b.amountMinor !== null && b.currency ? formatMoney(b.amountMinor, b.currency, locale) : null;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, gap: 2 },
  cover: { width: 84, height: 84, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
