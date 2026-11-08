import type { BookingStatus } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { Chips, PagedList } from '../../../seller/ui';
import { fetchMyBookings, svcKeys } from '../../../services/api';
import { deviceUtcOffset } from '../../../services/logic';
import { BookingCard } from '../../../services/ui';
import { useTheme } from '../../../theme/use-theme';

const STATUSES: ('' | BookingStatus)[] = ['', 'requested', 'confirmed', 'completed', 'cancelled', 'declined', 'no_show'];

/** Mes réservations (client). */
export default function MyBookings() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState<'' | BookingStatus>('');
  const query = useInfiniteQuery({
    queryKey: [...svcKeys.myBookings, status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchMyBookings(status || undefined, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('bookings.title') }} />
      <PagedList
        query={query}
        keyExtractor={(b) => b.id}
        header={
          <Chips
            options={STATUSES.map((s) => ({ value: s, label: s ? t(`bookings.status.${s}` as MessageKey) : t('services.all') }))}
            value={status}
            onChange={setStatus}
          />
        }
        renderItem={({ item }) => (
          <BookingCard
            booking={item}
            offset={deviceUtcOffset()}
            who={item.provider.name}
            onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: item.id } })}
          />
        )}
        empty={{
          icon: 'calendar-outline',
          title: t('bookings.emptyTitle'),
          body: t('bookings.emptyBody'),
          actionLabel: t('bookings.emptyAction'),
          onAction: () => router.push('/services'),
        }}
      />
    </View>
  );
}
