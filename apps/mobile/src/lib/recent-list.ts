import { Platform } from 'react-native';

export { pushRecent } from './recent-logic';

/** Liste récente mémorisée localement (donnée non sensible, jamais envoyée) : web = localStorage, mobile = fichier. */
export async function loadRecent(key: string): Promise<string[]> {
  try {
    let raw: string | null | undefined;
    if (Platform.OS === 'web') raw = globalThis.localStorage?.getItem(key);
    else {
      const { File, Paths } = await import('expo-file-system');
      const f = new File(Paths.document, key);
      raw = f.exists ? await f.text() : null;
    }
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveRecent(key: string, list: readonly string[]): Promise<void> {
  try {
    const raw = JSON.stringify(list);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, raw);
    else {
      const { File, Paths } = await import('expo-file-system');
      const f = new File(Paths.document, key);
      if (!f.exists) f.create();
      f.write(raw);
    }
  } catch {
    /* tant pis : la liste n'est qu'un confort */
  }
}
