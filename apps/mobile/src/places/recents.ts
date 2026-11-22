import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { addRecentPlace, parseRecentPlaces, type PickedPlace } from './picker-logic';

/** Derniers lieux choisis, sur l'appareil seulement. */
const KEY = 'caselind.place.recents';

export async function loadRecentPlaces(): Promise<PickedPlace[]> {
  try {
    return parseRecentPlaces(Platform.OS === 'web' ? (typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)) : await SecureStore.getItemAsync(KEY));
  } catch {
    return [];
  }
}

export async function pushRecentPlace(p: PickedPlace): Promise<void> {
  try {
    const value = JSON.stringify(addRecentPlace(await loadRecentPlaces(), p));
    if (Platform.OS === 'web') localStorage.setItem(KEY, value);
    else await SecureStore.setItemAsync(KEY, value);
  } catch {
    /* facultatif */
  }
}
