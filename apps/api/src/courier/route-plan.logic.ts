import type { CourierRouteStop } from '@caselind/contracts';
import { haversineKm } from '../mobility/mobility.shared.js';

/** One stop to visit. `after` is the key (`id:step`) of a stop that must come first (a drop-off follows its pick-up). */
export interface PlanNode {
  type: CourierRouteStop['type'];
  id: string;
  step: CourierRouteStop['step'];
  label: string;
  lat: number | null;
  lng: number | null;
  express: boolean;
  /** ISO slot, used to order the stops without coordinates. */
  due: string | null;
  after?: string;
}

export const nodeKey = (n: Pick<PlanNode, 'id' | 'step'>): string => `${n.id}:${n.step}`;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Nearest-neighbour tour from the courier position: always the closest stop whose pre-condition is met.
 * Stops without coordinates (order deliveries: the address is text) come last, express first, then the earliest slot.
 * Distances are straight lines times `detour` (the mobility detour factor), so the total is an estimate.
 * shortcut: greedy, not optimal (no 2-opt), fine for the 20 stops the endpoint accepts.
 */
export function planRoute(
  start: { lat: number; lng: number },
  nodes: PlanNode[],
  detour: number,
): { stops: CourierRouteStop[]; totalKm: number; unlocated: number } {
  const located = nodes.filter((n) => n.lat !== null && n.lng !== null);
  const rest = nodes.filter((n) => n.lat === null || n.lng === null);
  const done = new Set<string>();
  const stops: CourierRouteStop[] = [];
  let at = start;
  let total = 0;
  let pending = [...located].sort((a, b) => nodeKey(a).localeCompare(nodeKey(b)));
  const stopOf = (n: PlanNode, legKm: number | null): CourierRouteStop => ({
    type: n.type,
    id: n.id,
    step: n.step,
    label: n.label,
    lat: n.lat,
    lng: n.lng,
    legKm,
    express: n.express,
  });

  while (pending.length > 0) {
    // A node whose `after` is not in this plan (already done) is free.
    const known = new Set(nodes.map(nodeKey));
    const ready = pending.filter((n) => !n.after || !known.has(n.after) || done.has(n.after));
    if (ready.length === 0) break;
    let best = ready[0]!;
    let bestKm = haversineKm(at, { lat: best.lat!, lng: best.lng! });
    for (const n of ready.slice(1)) {
      const km = haversineKm(at, { lat: n.lat!, lng: n.lng! });
      if (km < bestKm) {
        best = n;
        bestKm = km;
      }
    }
    const leg = round2(bestKm * detour);
    total += leg;
    stops.push(stopOf(best, leg));
    done.add(nodeKey(best));
    at = { lat: best.lat!, lng: best.lng! };
    pending = pending.filter((n) => n !== best);
  }

  rest.sort((a, b) => Number(b.express) - Number(a.express) || (a.due ?? '9').localeCompare(b.due ?? '9') || nodeKey(a).localeCompare(nodeKey(b)));
  for (const n of rest) stops.push(stopOf(n, null));
  return { stops, totalKm: round2(total), unlocated: rest.length };
}
