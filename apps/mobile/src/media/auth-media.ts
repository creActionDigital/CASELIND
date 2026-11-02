import { Platform } from 'react-native';
import { api } from '../auth/auth-context';
import { absoluteUrl } from '../lib/config';

/** Cache mémoire : url de contenu -> URI affichable (fichier local sur natif, blob URL sur le web). */
const cache = new Map<string, Promise<string>>();

async function withToken<T>(run: (token: string) => Promise<{ status: number; value: T }>): Promise<T> {
  let token = api.getAccessToken();
  if (!token) token = await api.restore();
  let res = await run(token);
  if (res.status === 401) {
    token = await api.restore();
    res = await run(token);
  }
  return res.value;
}

async function load(contentUrl: string): Promise<string> {
  const url = absoluteUrl(contentUrl);
  if (Platform.OS === 'web') {
    return withToken(async (token) => {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        if (r.status === 401) return { status: 401, value: '' };
        throw new Error(`media_${r.status}`);
      }
      return { status: 200, value: URL.createObjectURL(await r.blob()) };
    });
  }
  const { Directory, File, Paths } = await import('expo-file-system');
  const dir = new Directory(Paths.cache, 'caselind-media');
  if (!dir.exists) dir.create({ intermediates: true });
  const name = url.replace(/[^a-zA-Z0-9]/g, '_').slice(-120);
  const target = new File(dir, name);
  if (target.exists) return target.uri;
  return withToken(async (token) => {
    try {
      const file = await File.downloadFileAsync(url, target, { headers: { Authorization: `Bearer ${token}` } });
      return { status: 200, value: file.uri };
    } catch (err) {
      if (/401/.test(String(err))) return { status: 401, value: '' };
      throw err;
    }
  });
}

/** Télécharge (une seule fois) un contenu média protégé par `Authorization`. */
export function getAuthMediaUri(contentUrl: string): Promise<string> {
  let p = cache.get(contentUrl);
  if (!p) {
    p = load(contentUrl);
    cache.set(contentUrl, p);
    p.catch(() => cache.delete(contentUrl)); // un échec ne reste pas en cache
  }
  return p;
}

/** À appeler au logout : les fichiers appartiennent à la session précédente. */
export function clearAuthMediaCache(): void {
  cache.clear();
}
