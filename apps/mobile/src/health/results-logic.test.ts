import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { buildResult, isRealDate, resultErrorKey, resultKindKey, SHARE_KINDS } from './results-logic';

const form = { kind: 'blood' as const, title: '  Glycémie ', summary: ' 0,92 g/L ', date: '2026-03-10' };

describe('health results logic', () => {
  it('accepts only real calendar days', () => {
    expect(isRealDate('2026-03-10')).toBe(true);
    expect(isRealDate('2026-02-31')).toBe(false);
    expect(isRealDate('10/03/2026')).toBe(false);
  });

  it('builds a trimmed request and refuses a missing title, a bad or future date, a too long text', () => {
    expect(buildResult(form, '2026-11-18')).toEqual({ ok: true, body: { kind: 'blood', title: 'Glycémie', summary: '0,92 g/L', resultDate: '2026-03-10', assetId: null } });
    expect(buildResult({ ...form, assetId: 'a' }, '2026-11-18')).toMatchObject({ ok: true, body: { assetId: 'a' } });
    expect(buildResult({ ...form, title: '   ' }, '2026-11-18')).toEqual({ ok: false, error: 'health.results.err.title' });
    expect(buildResult({ ...form, date: '2026-02-31' }, '2026-11-18')).toEqual({ ok: false, error: 'health.results.err.date' });
    expect(buildResult({ ...form, date: '2026-12-01' }, '2026-11-18')).toEqual({ ok: false, error: 'health.results.err.future' });
    expect(buildResult({ ...form, summary: 'x'.repeat(2001) }, '2026-11-18')).toEqual({ ok: false, error: 'health.results.err.summary' });
  });

  it('maps the server errors of this module', () => {
    expect(resultErrorKey(new ApiRequestError(409, 'conflict', 'x', { reason: 'limit_reached' }))).toBe('health.results.err.limit');
    expect(resultErrorKey(new ApiRequestError(400, 'validation_failed', 'x'))).toBe('health.results.err.invalid');
    expect(resultErrorKey(new ApiRequestError(403, 'feature_disabled', 'x'))).toBe('health.err.disabled');
    expect(resultErrorKey(new ApiRequestError(500, 'internal_error', 'x'))).toBeNull();
    expect(resultErrorKey(new Error('x'))).toBeNull();
  });

  it('lets a share cover the results next to the record kinds', () => {
    expect(SHARE_KINDS).toContain('results');
    expect(SHARE_KINDS).toHaveLength(8);
    expect(resultKindKey('imaging')).toBe('health.results.kind.imaging');
  });
});
