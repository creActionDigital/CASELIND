import { describe, expect, it } from 'vitest';
import { PublishRateLimiter } from './anti-spam.logic.js';

describe('PublishRateLimiter', () => {
  it('laisse passer la limite, refuse au-delà avec le délai de reprise, puis la fenêtre glisse', () => {
    const l = new PublishRateLimiter(3_600_000);
    const t0 = 1_000_000;
    expect(l.hit('u:post', 2, t0).ok).toBe(true);
    expect(l.hit('u:post', 2, t0 + 60_000).ok).toBe(true);
    expect(l.hit('u:post', 2, t0 + 120_000)).toEqual({ ok: false, retryAfterSeconds: 3480 });
    // un refus n'est pas compté ; une heure après le premier envoi, une place se libère
    expect(l.hit('u:post', 2, t0 + 3_600_000).ok).toBe(true);
    expect(l.hit('u:post', 2, t0 + 3_600_001).ok).toBe(false);
  });
  it('compte séparément chaque utilisateur et chaque type', () => {
    const l = new PublishRateLimiter();
    expect(l.hit('a:post', 1, 0).ok).toBe(true);
    expect(l.hit('a:comment', 1, 0).ok).toBe(true);
    expect(l.hit('b:post', 1, 0).ok).toBe(true);
    expect(l.hit('a:post', 1, 1).ok).toBe(false);
  });
});
