import { describe, expect, it } from 'vitest';
import { LOG_REDACT_PATHS, scrubLogUrl } from './log-scrub.js';

describe('log scrubbing', () => {
  it('drops the position and search text from the logged URL', () => {
    expect(scrubLogUrl('/v1/places?lat=-4.3&lng=15.3&radiusKm=5')).toBe('/v1/places?[redacted]');
    expect(scrubLogUrl('/v1/search?q=alice')).toBe('/v1/search?[redacted]');
    expect(scrubLogUrl('/v1/search/history')).toBe('/v1/search/history');
    expect(scrubLogUrl('/v1/catalog/products?limit=5')).toBe('/v1/catalog/products?limit=5');
  });

  it('redacts the QR polling secret header', () => {
    expect(LOG_REDACT_PATHS).toContain('req.headers["x-qr-session-secret"]');
  });
});
