import { describe, expect, it } from 'vitest';
import { canSeat, dayWindow, departureInRange, maxSeatPriceMinor, roundCoord, statusForSeats } from './carpool.logic.js';
import { decodeCursor, encodeCursor } from './extra.shared.js';
import { periodProblem, periodsOverlap, rentalDays, rentalTotalMinor } from './rentals.logic.js';

describe('carpool logic', () => {
  it('caps the seat price at twice the estimated fare', () => {
    expect(maxSeatPriceMinor(500)).toBe(1000);
    expect(maxSeatPriceMinor(333)).toBe(666);
  });

  it('accepts a departure between 30 minutes and 60 days ahead only', () => {
    const now = new Date('2026-06-01T10:00:00Z');
    expect(departureInRange(new Date('2026-06-01T10:29:00Z'), now)).toBe(false);
    expect(departureInRange(new Date('2026-06-01T10:30:00Z'), now)).toBe(true);
    expect(departureInRange(new Date('2026-07-31T10:00:00Z'), now)).toBe(true);
    expect(departureInRange(new Date('2026-07-31T10:00:01Z'), now)).toBe(false);
  });

  it('rounds to 3 decimals, counts seats and derives the status', () => {
    expect(roundCoord(-1.65849)).toBe(-1.658);
    expect(roundCoord(29.2205)).toBe(29.221);
    expect(canSeat(2, 2)).toBe(true);
    expect(canSeat(1, 2)).toBe(false);
    expect(canSeat(0, 1)).toBe(false);
    expect(statusForSeats(0)).toBe('full');
    expect(statusForSeats(1)).toBe('open');
  });

  it('builds a UTC day window and rejects an unreal date', () => {
    expect(dayWindow('2026-06-01')?.end.toISOString()).toBe('2026-06-02T00:00:00.000Z');
    expect(dayWindow('2026-02-31')).toBeNull();
  });

  it('round-trips a cursor and rejects garbage', () => {
    const c = encodeCursor('2026-06-01T10:00:00.000Z', 'abc');
    expect(decodeCursor(c)).toEqual({ ts: '2026-06-01T10:00:00.000Z', id: 'abc' });
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });
});

describe('rental logic', () => {
  it('counts days with both ends included and computes the total', () => {
    expect(rentalDays('2026-06-10', '2026-06-10')).toBe(1);
    expect(rentalDays('2026-06-10', '2026-06-12')).toBe(3);
    expect(rentalDays('2026-02-27', '2026-03-02')).toBe(4);
    expect(rentalTotalMinor(3, 2500)).toBe(7500);
  });

  it('detects overlapping inclusive periods', () => {
    const a = { from: '2026-06-10', to: '2026-06-12' };
    expect(periodsOverlap(a, { from: '2026-06-12', to: '2026-06-14' })).toBe(true);
    expect(periodsOverlap(a, { from: '2026-06-13', to: '2026-06-14' })).toBe(false);
    expect(periodsOverlap(a, { from: '2026-06-01', to: '2026-06-09' })).toBe(false);
    expect(periodsOverlap(a, { from: '2026-06-11', to: '2026-06-11' })).toBe(true);
  });

  it('validates a period', () => {
    const today = '2026-06-01';
    expect(periodProblem('2026-06-02', '2026-06-04', today)).toBeNull();
    expect(periodProblem('2026-06-01', '2026-06-30', today)).toBeNull();
    expect(periodProblem('2026-06-01', '2026-07-01', today)).toBe('period_too_long');
    expect(periodProblem('2026-06-05', '2026-06-04', today)).toBe('period_order');
    expect(periodProblem('2026-05-31', '2026-06-02', today)).toBe('in_the_past');
    expect(periodProblem('2026-02-30', '2026-03-02', today)).toBe('invalid_date');
    expect(periodProblem('2028-06-01', '2028-06-02', today)).toBe('too_far_ahead');
  });
});
