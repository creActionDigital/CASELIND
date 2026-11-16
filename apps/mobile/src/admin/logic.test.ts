import { describe, expect, it } from 'vitest';
import { isValidReason, orgActions, userActions } from './logic';

describe('admin governance logic', () => {
  it('validates the reason length after trimming', () => {
    expect(isValidReason('  ab  ')).toBe(false);
    expect(isValidReason(' abc ')).toBe(true);
    expect(isValidReason('x'.repeat(501))).toBe(false);
  });
  it('offers actions by status', () => {
    expect(userActions('active')).toEqual(['suspend']);
    expect(userActions('suspended')).toEqual(['reactivate']);
    expect(userActions('pending')).toEqual([]);
    expect(orgActions('active', 'unverified')).toEqual(['suspend', 'verify']);
    expect(orgActions('suspended', 'verified')).toEqual(['reactivate', 'unverify']);
  });
});
