import { RETURN_TRANSITIONS, type ReturnStatus } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { availableActions, buildReturnRequest, clampQty, isClosed, returnReasonKey, windowInfo } from './logic';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-19T12:00:00Z');
const at = (ms: number) => new Date(ms).toISOString();

describe('windowInfo', () => {
  it('is none before delivery, open with the days left, closed after', () => {
    expect(windowInfo(null, NOW)).toEqual({ state: 'none' });
    expect(windowInfo(at(NOW + 7 * DAY), NOW)).toEqual({ state: 'open', daysLeft: 7 });
    expect(windowInfo(at(NOW + 2.2 * DAY), NOW)).toEqual({ state: 'open', daysLeft: 3 });
    expect(windowInfo(at(NOW + 1000), NOW)).toEqual({ state: 'open', daysLeft: 1 });
    expect(windowInfo(at(NOW), NOW)).toEqual({ state: 'closed' });
    expect(windowInfo(at(NOW - DAY), NOW)).toEqual({ state: 'closed' });
  });
});

describe('availableActions', () => {
  const r = (status: ReturnStatus, resolution: 'refund_buyer' | 'refund_partial' | 'reject' | null = null) => ({ status, resolution });

  it('gives each role only its own steps', () => {
    expect(availableActions('buyer', r('requested'))).toEqual(['cancel']);
    expect(availableActions('buyer', r('rejected'))).toEqual(['dispute']);
    expect(availableActions('buyer', r('approved'))).toEqual([]);
    expect(availableActions('org', r('requested'))).toEqual(['approve', 'reject']);
    expect(availableActions('org', r('approved'))).toEqual(['received', 'refunded']);
    expect(availableActions('org', r('received'))).toEqual(['refunded']);
    expect(availableActions('org', r('disputed'))).toEqual([]);
    expect(availableActions('admin', r('disputed'))).toEqual(['resolve']);
    expect(availableActions('admin', r('requested'))).toEqual([]);
  });

  it('leaves nothing to refund after a platform rejection', () => {
    expect(availableActions('org', r('resolved', 'refund_partial'))).toEqual(['refunded']);
    expect(availableActions('org', r('resolved', 'reject'))).toEqual([]);
  });

  it('offers nothing on closed returns', () => {
    for (const s of ['refunded', 'cancelled'] as const) {
      expect(isClosed(s)).toBe(true);
      for (const kind of ['buyer', 'org', 'admin'] as const) expect(availableActions(kind, r(s))).toEqual([]);
    }
  });

  it('never lets a role skip the state machine of the contract', () => {
    for (const kind of ['buyer', 'org', 'admin'] as const) {
      for (const [from, to] of Object.entries(RETURN_TRANSITIONS[kind])) expect(to!.length).toBeGreaterThan(0), expect(isClosed(from as ReturnStatus)).toBe(false);
    }
  });
});

describe('buildReturnRequest', () => {
  const items = [{ id: 'a', quantity: 2 }, { id: 'b', quantity: 1 }];

  it('keeps the lines with a quantity and trims the details', () => {
    expect(buildReturnRequest('defective', '  cassé ', { a: 1, b: 0 }, items)).toEqual({ ok: { reason: 'defective', details: 'cassé', items: [{ orderItemId: 'a', quantity: 1 }] } });
    expect(buildReturnRequest('other', '   ', { b: 1 }, items)).toEqual({ ok: { reason: 'other', items: [{ orderItemId: 'b', quantity: 1 }] } });
  });

  it('refuses an empty selection and a quantity above the order', () => {
    expect(buildReturnRequest('other', '', {}, items)).toEqual({ error: 'none' });
    expect(buildReturnRequest('other', '', { a: 3 }, items)).toEqual({ error: 'quantity' });
  });
});

describe('helpers', () => {
  it('clamps quantities to the ordered range', () => {
    expect(clampQty(5, 2)).toBe(2);
    expect(clampQty(-1, 2)).toBe(0);
    expect(clampQty(1.9, 2)).toBe(1);
    expect(clampQty(Number.NaN, 2)).toBe(0);
  });

  it('recognises the return-specific 409 reasons only', () => {
    expect(returnReasonKey('window_closed')).toBe('window_closed');
    expect(returnReasonKey('invalid_transition')).toBe('invalid_transition');
    expect(returnReasonKey('stock_negative')).toBeNull();
    expect(returnReasonKey(undefined)).toBeNull();
  });
});
