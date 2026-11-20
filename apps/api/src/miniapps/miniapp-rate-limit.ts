export type RateDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

interface Counter {
  minute: number;
  minuteCount: number;
  day: number;
  dayCount: number;
}

/**
 * Fixed-window limiter per OAuth client (per minute and per UTC day), counted for every call made with an app token.
 * shortcut: counters live in this process only (like the NestJS throttler): with N instances the real ceiling is N times
 * the configured one; move to a shared store (Redis) when the API runs on several instances.
 */
export class MiniAppRateLimiter {
  private readonly counters = new Map<string, Counter>();

  hit(appId: string, perMinute: number, perDay: number, now = Date.now()): RateDecision {
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    if (this.counters.size > 20_000) this.prune(minute, day);
    let c = this.counters.get(appId);
    if (!c) {
      c = { minute, minuteCount: 0, day, dayCount: 0 };
      this.counters.set(appId, c);
    }
    if (c.minute !== minute) {
      c.minute = minute;
      c.minuteCount = 0;
    }
    if (c.day !== day) {
      c.day = day;
      c.dayCount = 0;
    }
    // A refused call is not counted: the budget is for calls that were served.
    if (c.dayCount >= perDay) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(((day + 1) * 86_400_000 - now) / 1000)) };
    if (c.minuteCount >= perMinute) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(((minute + 1) * 60_000 - now) / 1000)) };
    c.minuteCount += 1;
    c.dayCount += 1;
    return { ok: true };
  }

  private prune(minute: number, day: number): void {
    for (const [k, c] of this.counters) if (c.day !== day && c.minute !== minute) this.counters.delete(k);
  }
}
