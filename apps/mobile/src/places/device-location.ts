import { Platform } from 'react-native';
import type { LatLng } from './geo';

export type LocationOutcome = { ok: true; position: LatLng } | { ok: false; reason: 'denied' | 'unavailable' };

/**
 * Position actuelle de l'appareil, demandée à la demande (jamais en continu, jamais stockée).
 * Web : API du navigateur ; natif : `expo-location` (permission « pendant l'utilisation »).
 */
export async function getDevicePosition(): Promise<LocationOutcome> {
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return { ok: false, reason: 'unavailable' };
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ ok: true, position: { lat: p.coords.latitude, lng: p.coords.longitude } }),
        (e) => resolve({ ok: false, reason: e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      );
    });
  }
  try {
    const Location = await import('expo-location');
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ok: false, reason: 'denied' };
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { ok: true, position: { lat: p.coords.latitude, lng: p.coords.longitude } };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
