import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { ApiRequestError } from '../lib/api';
import { getDevicePosition } from '../places/device-location';
import { postDriverLocation } from './api';
import { createDriverLocationPump, isDriverLocationStop } from './logic';

/**
 * Envoie la position du chauffeur environ toutes les 20 s tant que `enabled` et que l'écran est au premier plan
 * (un seul écran à la fois émet). Arrêt immédiat hors ligne ; rien n'est conservé sur l'appareil.
 */
export function useDriverLocation(enabled: boolean, onStopped: () => void) {
  const stopped = useRef(onStopped);
  stopped.current = onStopped;
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const pump = createDriverLocationPump({
        getPosition: async () => {
          const r = await getDevicePosition();
          return r.ok ? r.position : null;
        },
        send: (p) => postDriverLocation(p.lat, p.lng),
        shouldStop: (e) => e instanceof ApiRequestError && isDriverLocationStop(e.status, e.detail<string>('reason') ?? e.code),
        onStop: () => stopped.current(),
      });
      pump.start();
      return () => pump.stop();
    }, [enabled]),
  );
}
