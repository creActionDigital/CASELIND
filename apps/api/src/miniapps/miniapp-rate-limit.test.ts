import { describe, expect, it } from 'vitest';
import { MiniAppRateLimiter } from './miniapp-rate-limit.js';

describe('MiniAppRateLimiter', () => {
  const t0 = Date.UTC(2026, 0, 1, 10, 0, 20);

  it('limits per minute with a Retry-After up to the next minute, then resets', () => {
    const l = new MiniAppRateLimiter();
    expect(l.hit('a', 2, 100, t0)).toEqual({ ok: true });
    expect(l.hit('a', 2, 100, t0 + 1000)).toEqual({ ok: true });
    expect(l.hit('a', 2, 100, t0 + 2000)).toEqual({ ok: false, retryAfterSeconds: 38 });
    expect(l.hit('b', 2, 100, t0 + 2000)).toEqual({ ok: true });
    expect(l.hit('a', 2, 100, t0 + 40_000)).toEqual({ ok: true });
  });

  it('limits per day and refused calls do not consume budget', () => {
    const l = new MiniAppRateLimiter();
    expect(l.hit('a', 10, 2, t0).ok).toBe(true);
    expect(l.hit('a', 10, 2, t0 + 61_000).ok).toBe(true);
    const refused = l.hit('a', 10, 2, t0 + 122_000);
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.retryAfterSeconds).toBeGreaterThan(3600);
    expect(l.hit('a', 10, 3, t0 + 122_000).ok).toBe(true);
    expect(l.hit('a', 10, 2, t0 + 86_400_000).ok).toBe(true);
  });
});
