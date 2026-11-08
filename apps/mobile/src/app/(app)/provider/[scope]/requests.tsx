import type { BookingStatus } from '@caselind/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18n, type MessageKey } from '../../../../i18n';
import { Chips, PagedList } from '../../../../seller/ui';
import { fetchReceived, svcKeys } from '../../../../services/api';
import { deviceUtcOffset } from '../../../../services/logic';
import { BookingCard } from '../../../../services/ui';
import { useTheme } from '../../../../theme/use-theme';

const STATUSES: ('' | BookingStatus)[] = ['', 'requested', 'confirmed', 'completed', 'cancelled', 'declined', 'no_show'];

/** Demandes reçues par le prestataire ; les actions (confirmer, refuser, devis, terminer, absent) sont dans le détail. */
export default function Requests() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const { scope } = useLocalSearchParams<{ scope: string }>();
  const [status, setStatus] = useState<'' | BookingStatus>('requested');
  const query = useInfiniteQuery({
    queryKey: [...svcKeys.received(scope), status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchReceived(scope, status || undefined, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('bookings.recv.title') }} />
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
            who={`${item.client.displayName} (@${item.client.handle})`}
            onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: item.id } })}
          />
        )}
        empty={{ icon: 'mail-open-outline', title: t('bookings.recv.emptyTitle'), body: t('bookings.recv.emptyBody') }}
      />
    </View>
  );
}
