import { describe, expect, it } from 'vitest';
import { type PlanNode, planRoute } from './route-plan.logic.js';

const node = (id: string, step: PlanNode['step'], lat: number | null, lng: number | null, extra: Partial<PlanNode> = {}): PlanNode => ({
  type: 'courier_request',
  id,
  step,
  label: `${id}-${step}`,
  lat,
  lng,
  express: false,
  due: null,
  ...extra,
});

const START = { lat: 0, lng: 0 };

describe('planRoute', () => {
  it('visits the nearest stop first, then the nearest from there', () => {
    const plan = planRoute(START, [node('far', 'pickup', 0, 0.3), node('near', 'pickup', 0, 0.1), node('mid', 'pickup', 0, 0.2)], 1);
    expect(plan.stops.map((s) => s.id)).toEqual(['near', 'mid', 'far']);
    expect(plan.totalKm).toBeCloseTo(33.36, 1);
    expect(plan.stops[0]!.legKm).toBeCloseTo(11.12, 1);
    expect(plan.unlocated).toBe(0);
  });

  it('never drops off before the pick-up, even when the drop-off is nearer', () => {
    const plan = planRoute(
      START,
      [
        node('a', 'pickup', 0, 0.2),
        node('a', 'dropoff', 0, 0.01, { after: 'a:pickup' }),
        node('b', 'pickup', 0, 0.25),
      ],
      1,
    );
    const order = plan.stops.map((s) => `${s.id}:${s.step}`);
    expect(order.indexOf('a:pickup')).toBeLessThan(order.indexOf('a:dropoff'));
    expect(order).toEqual(['a:pickup', 'b:pickup', 'a:dropoff']);
  });

  it('a drop-off whose pick-up is not in the plan (already picked up) is free', () => {
    const plan = planRoute(START, [node('a', 'dropoff', 0, 0.1, { after: 'a:pickup' })], 1);
    expect(plan.stops).toHaveLength(1);
  });

  it('puts stops without coordinates last, express first then the earliest slot, and scales the distance by the detour', () => {
    const plan = planRoute(
      START,
      [
        node('d1', 'delivery', null, null, { type: 'delivery', due: '2026-12-01T10:00:00.000Z' }),
        node('d2', 'delivery', null, null, { type: 'delivery', express: true, due: '2026-12-01T12:00:00.000Z' }),
        node('d3', 'delivery', null, null, { type: 'delivery', due: '2026-12-01T09:00:00.000Z' }),
        node('r', 'pickup', 0, 0.1),
      ],
      1.5,
    );
    expect(plan.stops.map((s) => s.id)).toEqual(['r', 'd2', 'd3', 'd1']);
    expect(plan.unlocated).toBe(3);
    expect(plan.stops[1]!.legKm).toBeNull();
    expect(plan.totalKm).toBeCloseTo(16.68, 1);
  });

  it('is deterministic on ties and handles an empty plan', () => {
    const a = planRoute(START, [node('x', 'pickup', 0.1, 0), node('y', 'pickup', -0.1, 0)], 1);
    const b = planRoute(START, [node('y', 'pickup', -0.1, 0), node('x', 'pickup', 0.1, 0)], 1);
    expect(a.stops.map((s) => s.id)).toEqual(b.stops.map((s) => s.id));
    expect(planRoute(START, [], 1)).toEqual({ stops: [], totalKm: 0, unlocated: 0 });
  });
});
