/** Limiteur par clé : `allow(key)` renvoie true au plus une fois par `intervalMs`. */
export function createThrottle(intervalMs: number, now: () => number = Date.now) {
  const last = new Map<string, number>();
  return {
    allow(key: string): boolean {
      const t = now();
      const prev = last.get(key);
      if (prev !== undefined && t - prev < intervalMs) return false;
      last.set(key, t);
      return true;
    },
    reset(key?: string) {
      if (key) last.delete(key);
      else last.clear();
    },
  };
}

export const TYPING_EMIT_INTERVAL_MS = 2000;
/** Un indicateur « écrit… » s'éteint si aucun nouvel événement n'arrive dans ce délai. */
export const TYPING_EXPIRE_MS = 4000;
