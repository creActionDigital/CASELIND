import { Platform } from 'react-native';

/** Dernière adresse de livraison, mémorisée localement (donnée non sensible : pas de SecureStore). */
export interface SavedAddress {
  name: string;
  phone: string;
  city: string;
  line1: string;
  line2: string;
  notes: string;
}

const KEY = 'caselind-last-address.json';
let memory: SavedAddress | null = null;

export async function loadAddress(): Promise<SavedAddress | null> {
  if (memory) return memory;
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(KEY);
      memory = raw ? (JSON.parse(raw) as SavedAddress) : null;
    } else {
      const { File, Paths } = await import('expo-file-system');
      const file = new File(Paths.document, KEY);
      memory = file.exists ? (JSON.parse(await file.text()) as SavedAddress) : null;
    }
  } catch {
    memory = null;
  }
  return memory;
}

export async function saveAddress(address: SavedAddress): Promise<void> {
  memory = address;
  try {
    const raw = JSON.stringify(address);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(KEY, raw);
    } else {
      const { File, Paths } = await import('expo-file-system');
      const file = new File(Paths.document, KEY);
      if (!file.exists) file.create();
      file.write(raw);
    }
  } catch {
    /* mémoire seulement */
  }
}
