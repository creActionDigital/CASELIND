export type PermissionKind = 'notifications' | 'location' | 'camera' | 'photos';
export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** Réponse commune des API Expo de permission (`status`, `canAskAgain`). */
export interface RawPermission {
  status?: string;
  granted?: boolean;
  canAskAgain?: boolean;
}

export function toState(r: RawPermission | null | undefined): PermissionState {
  if (!r) return 'unavailable';
  if (r.granted || r.status === 'granted') return 'granted';
  if (r.status === 'denied') return 'denied';
  return 'undetermined';
}

/** Action proposée : demander, ouvrir les réglages du téléphone (refus définitif) ou rien. */
export function nextAction(state: PermissionState, canAskAgain: boolean): 'ask' | 'settings' | 'none' {
  if (state === 'granted' || state === 'unavailable') return 'none';
  if (state === 'denied' && !canAskAgain) return 'settings';
  return 'ask';
}
