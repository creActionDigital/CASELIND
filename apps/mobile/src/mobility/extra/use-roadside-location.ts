import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { ApiRequestError } from '../../lib/api';
import { getDevicePosition } from '../../places/device-location';
import { createDriverLocationPump } from '../logic';
import { postRoadsideLocation } from './api';

/**
 * Le prestataire en route envoie sa position environ toutes les 20 s, seulement avec son consentement (`enabled`)
 * et tant que l’écran est au premier plan. Arrêt si le serveur refuse (consentement retiré, demande terminée).
 */
export function useRoadsideLocation(enabled: boolean, requestId: string, onStopped: () => void) {
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
        send: (p) => postRoadsideLocation(requestId, p.lat, p.lng),
        shouldStop: (e) => e instanceof ApiRequestError && (e.status === 403 || e.status === 404 || e.status === 409),
        onStop: () => stopped.current(),
      });
      pump.start();
      return () => pump.stop();
    }, [enabled, requestId]),
  );
}
