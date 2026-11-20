/** Limites de publication par utilisateur (anti-spam, CDC §26) : valeurs par défaut, surchargeables par l'environnement. */
export const DEFAULT_POSTS_PER_HOUR = 20;
export const DEFAULT_COMMENTS_PER_HOUR = 60;

export type RateVerdict = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Fenêtre glissante d'une heure par (utilisateur, type). Un refus n'est pas compté.
 * shortcut: compteurs en mémoire du processus (comme le limiteur NestJS) : avec N instances le plafond réel est N fois la limite ; passer à Redis au besoin.
 */
export class PublishRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly windowMs = 3_600_000) {}

  hit(key: string, limit: number, now = Date.now()): RateVerdict {
    if (this.hits.size > 50_000) this.prune(now);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true };
  }

  private prune(now: number): void {
    for (const [k, v] of this.hits) if (v.length === 0 || now - v[v.length - 1]! >= this.windowMs) this.hits.delete(k);
  }
}
