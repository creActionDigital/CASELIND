/**
 * Secret client montré UNE fois après la création : transmis à l'écran de détail par la mémoire du processus
 * (jamais par l'adresse de la page, jamais sur disque). `take` le lit et l'oublie.
 */
const pending = new Map<string, string>();

export const holdSecret = (appId: string, secret: string): void => void pending.set(appId, secret);

export function takeSecret(appId: string): string | null {
  const s = pending.get(appId) ?? null;
  pending.delete(appId);
  return s;
}
