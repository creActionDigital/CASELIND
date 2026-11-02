import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { buildDetails, reportErrorKey, validateReport } from './validate';

describe('validateReport', () => {
  it('exige un motif', () => {
    expect(validateReport({ reason: null, details: '' })).toBe('reason');
    expect(validateReport({ reason: 'spam', details: '' })).toBeNull();
  });
  it('limite les détails à 1000 caractères', () => {
    expect(validateReport({ reason: 'other', details: 'x'.repeat(1001) })).toBe('details');
    expect(validateReport({ reason: 'other', details: 'x'.repeat(1000) })).toBeNull();
  });
  it('omet des détails vides', () => {
    expect(buildDetails('   ')).toBeUndefined();
    expect(buildDetails(' a ')).toBe('a');
  });
  it('traduit 404, 409, 429', () => {
    expect(reportErrorKey(new ApiRequestError(404, 'not_found', ''))).toBe('report.error.unavailable');
    expect(reportErrorKey(new ApiRequestError(409, 'already_reported', ''))).toBe('report.error.already');
    expect(reportErrorKey(new ApiRequestError(429, 'rate_limited', ''))).toBe('report.error.rate');
    expect(reportErrorKey(new ApiRequestError(500, 'x', ''))).toBeNull();
  });
});
