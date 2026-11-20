import type { InventoryCountDetail } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { batchTone, buildBatch, changedLines, draftOf, parseCounted, parsePositive, varianceLabel } from './logic';

describe('expiry tone', () => {
  it('classifies batches', () => {
    expect(batchTone({ expired: true, daysToExpiry: -2, quantityRemaining: 3 })).toBe('expired');
    expect(batchTone({ expired: false, daysToExpiry: 0, quantityRemaining: 3 })).toBe('soon');
    expect(batchTone({ expired: false, daysToExpiry: 7, quantityRemaining: 3 })).toBe('soon');
    expect(batchTone({ expired: false, daysToExpiry: 8, quantityRemaining: 3 })).toBe('ok');
    expect(batchTone({ expired: false, daysToExpiry: null, quantityRemaining: 3 })).toBe('none');
  });
});

describe('quantities', () => {
  it('parses positive and counted quantities', () => {
    expect(parsePositive('12')).toBe(12);
    expect(parsePositive('0')).toBeNull();
    expect(parsePositive('1.5')).toBeNull();
    expect(parseCounted('0')).toBe(0);
    expect(parseCounted('-1')).toBeNull();
    expect(parseCounted('1000001')).toBeNull();
  });
  it('labels a variance with its sign', () => {
    expect(varianceLabel(3)).toBe('+3');
    expect(varianceLabel(-1)).toBe('-1');
    expect(varianceLabel(0)).toBe('0');
  });
});

describe('batch form', () => {
  const base = { batchCode: ' L1 ', expiresOn: '', quantity: '10', enterStock: false, note: '' };
  it('builds the request, expiry and note optional', () => {
    expect(buildBatch(base)).toEqual({ ok: { batchCode: 'L1', quantity: 10, enterStock: false } });
    expect(buildBatch({ ...base, expiresOn: '2027-01-31', enterStock: true, note: ' A ' })).toEqual({ ok: { batchCode: 'L1', quantity: 10, enterStock: true, expiresOn: '2027-01-31', note: 'A' } });
  });
  it('names the first error', () => {
    expect(buildBatch({ ...base, batchCode: ' ' })).toEqual({ error: 'code' });
    expect(buildBatch({ ...base, expiresOn: '2027-02-30' })).toEqual({ error: 'expiresOn' });
    expect(buildBatch({ ...base, quantity: '0' })).toEqual({ error: 'quantity' });
  });
});

describe('count lines', () => {
  const saved = [{ variantId: 'a', sku: 'A', productTitle: 'P', countedQuantity: 4, systemQuantity: 5, variance: -1, countedBy: null }] as InventoryCountDetail['lines'];
  it('sends only typed quantities that changed', () => {
    expect(changedLines({ a: '4', b: '7', c: '  ' }, saved)).toEqual({ ok: [{ variantId: 'b', countedQuantity: 7 }] });
    expect(changedLines({ a: '5' }, saved)).toEqual({ ok: [{ variantId: 'a', countedQuantity: 5 }] });
    expect(changedLines({ a: 'x' }, saved)).toEqual({ error: 'a' });
  });
  it('starts the draft from the saved quantities', () => {
    expect(draftOf({ lines: saved } as InventoryCountDetail)).toEqual({ a: '4' });
    expect(draftOf(undefined)).toEqual({});
  });
});
