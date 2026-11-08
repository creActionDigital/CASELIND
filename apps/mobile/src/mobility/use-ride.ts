import type { RideView } from '@caselind/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useRealtime } from '../realtime/realtime-context';
import { fetchRide, rideKeys } from './api';
import { isLiveRide } from './logic';

/**
 * Une course et son temps réel : `ride.updated` recharge la course, `ride.location` met à jour la position du
 * chauffeur sans requête, `ride.message` recharge les messages rapides. Sans socket, relevé toutes les 10 s tant que la course est vivante.
 */
export function useRide(id: string) {
  const qc = useQueryClient();
  const { socket, connected } = useRealtime();
  const q = useQuery({
    queryKey: rideKeys.ride(id),
    queryFn: () => fetchRide(id),
    retry: false,
    refetchInterval: (query) => {
      const s = (query.state.data as RideView | undefined)?.status;
      return s && isLiveRide(s) && !connected ? 10_000 : false;
    },
  });

  useEffect(() => {
    if (!socket) return;
    const onUpdated = (ev: { rideId?: unknown } | null) => {
      if (ev?.rideId !== id) return;
      void qc.invalidateQueries({ queryKey: rideKeys.ride(id) });
      void qc.invalidateQueries({ queryKey: rideKeys.minePrefix });
    };
    const onLocation = (ev: { rideId?: unknown; lat?: unknown; lng?: unknown; updatedAt?: unknown } | null) => {
      if (ev?.rideId !== id || typeof ev.lat !== 'number' || typeof ev.lng !== 'number' || typeof ev.updatedAt !== 'string') return;
      const loc = { lat: ev.lat, lng: ev.lng, updatedAt: ev.updatedAt };
      qc.setQueryData<RideView>(rideKeys.ride(id), (old) => (old ? { ...old, driverLocation: loc } : old));
    };
    const onMessage = (ev: { rideId?: unknown } | null) => {
      if (ev?.rideId === id) void qc.invalidateQueries({ queryKey: rideKeys.messages(id) });
    };
    socket.on('ride.updated', onUpdated);
    socket.on('ride.location', onLocation);
    socket.on('ride.message', onMessage);
    // Rattrapage après une coupure.
    const onConnect = () => void qc.invalidateQueries({ queryKey: rideKeys.ride(id) });
    socket.on('connect', onConnect);
    return () => {
      socket.off('ride.updated', onUpdated);
      socket.off('ride.location', onLocation);
      socket.off('ride.message', onMessage);
      socket.off('connect', onConnect);
    };
  }, [socket, id, qc]);

  return q;
}
