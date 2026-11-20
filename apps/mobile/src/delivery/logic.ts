import type { CartGroup, DeliverySpeed, DeliveryStatus, DeliveryZone, Fulfillment } from '@caselind/contracts';

/* Logique pure de la livraison (lot 8) : totaux avec frais, transitions du livreur, minuterie de position. */

/* ------------------------------------------------------------------ zones et totaux */

/** Minuscules, sans accents, espaces simples : même règle que le serveur pour comparer villes et quartiers. */
export function normalizeArea(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Frais de la zone dans la devise de la commande ; null si la zone n'a pas de tarif pour cette devise. */
export function zoneFee(zone: Pick<DeliveryZone, 'fees'>, currency: string): number | null {
  const f = zone.fees[currency];
  return typeof f === 'number' ? f : null;
}

/** Supplément express de la zone dans la devise ; null = express non proposé (zone sans supplément pour cette devise). */
export function expressSupplement(zone: Pick<DeliveryZone, 'expressFees'>, currency: string): number | null {
  const f = zone.expressFees?.[currency];
  return typeof f === 'number' ? f : null;
}

/** Indication seulement (le serveur décide) : la ville ou la 2e ligne figure parmi les zones couvertes. */
export function zoneCovers(zone: Pick<DeliveryZone, 'areas'>, city: string, line2: string): boolean {
  const wanted = [normalizeArea(city), normalizeArea(line2)].filter(Boolean);
  const areas = zone.areas.map(normalizeArea);
  return wanted.some((w) => areas.includes(w));
}

/** Zones proposables : actives et tarifées dans la devise, celles qui couvrent l'adresse d'abord. */
export function usableZones(zones: readonly DeliveryZone[], currency: string, city: string, line2: string): DeliveryZone[] {
  return zones
    .filter((z) => z.active && zoneFee(z, currency) !== null)
    .map((z, i) => ({ z, i, covers: zoneCovers(z, city, line2) }))
    .sort((a, b) => Number(b.covers) - Number(a.covers) || a.i - b.i)
    .map((x) => x.z);
}

/**
 * Une boutique sans zone active livre gratuitement (aucun choix) ; avec des zones, il faut en choisir une.
 * Retrait : jamais de zone.
 */
export function zoneRequired(fulfillment: Fulfillment, activeZoneCount: number): boolean {
  return fulfillment === 'delivery' && activeZoneCount > 0;
}

export interface OrderPlan {
  fulfillment: Fulfillment;
  zone: DeliveryZone | null;
  /** Défaut : standard. */
  speed?: DeliverySpeed;
}

export interface PlannedTotal {
  orgId: string;
  currency: string;
  subtotalMinor: number;
  feeMinor: number;
  totalMinor: number;
}

/** Frais d'une commande (retrait ou sans zone : 0). */
export function feeFor(plan: OrderPlan | undefined, currency: string): number {
  if (!plan || plan.fulfillment === 'pickup' || !plan.zone) return 0;
  const base = zoneFee(plan.zone, currency) ?? 0;
  return plan.speed === 'express' ? base + (expressSupplement(plan.zone, currency) ?? 0) : base;
}

/** Total par boutique : sous-total + frais (la remise éventuelle est calculée par le serveur). */
export function plannedTotals(groups: readonly CartGroup[], plans: Readonly<Record<string, OrderPlan>>): PlannedTotal[] {
  return groups.map((g) => {
    const feeMinor = feeFor(plans[g.orgId], g.currency);
    return { orgId: g.orgId, currency: g.currency, subtotalMinor: g.subtotalMinor, feeMinor, totalMinor: g.subtotalMinor + feeMinor };
  });
}

/** Totaux à payer par devise (jamais de somme entre devises). */
export function totalsByCurrencyWithFees(planned: readonly PlannedTotal[]): { currency: string; totalMinor: number }[] {
  const map = new Map<string, number>();
  for (const p of planned) map.set(p.currency, (map.get(p.currency) ?? 0) + p.totalMinor);
  return [...map].map(([currency, totalMinor]) => ({ currency, totalMinor }));
}

export type FulfillmentMap = Readonly<Record<string, Fulfillment | undefined>>;

/** Le checkout envoie un seul mode : livraison si au moins une boutique livre, sinon retrait. */
export function overallFulfillment(groups: readonly CartGroup[], modes: FulfillmentMap): Fulfillment {
  return groups.every((g) => (modes[g.orgId] ?? 'delivery') === 'pickup') ? 'pickup' : 'delivery';
}

/** Adresse obligatoire dès qu'une boutique livre. */
export const addressRequired = (groups: readonly CartGroup[], modes: FulfillmentMap): boolean => overallFulfillment(groups, modes) === 'delivery';

/** Choix de zone à envoyer (boutiques en livraison qui ont des zones) et boutiques où il en manque une. */
export function zoneChoices(
  groups: readonly CartGroup[],
  modes: FulfillmentMap,
  activeZoneCounts: Readonly<Record<string, number>>,
  chosen: Readonly<Record<string, string | undefined>>,
): { choices: { orgId: string; zoneId: string }[]; missing: string[] } {
  const choices: { orgId: string; zoneId: string }[] = [];
  const missing: string[] = [];
  for (const g of groups) {
    if (!zoneRequired(modes[g.orgId] ?? 'delivery', activeZoneCounts[g.orgId] ?? 0)) continue;
    const zoneId = chosen[g.orgId];
    if (zoneId) choices.push({ orgId: g.orgId, zoneId });
    else missing.push(g.orgId);
  }
  return { choices, missing };
}

/* ------------------------------------------------------------------ livreur */

export type CourierAction = 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'returned';

/** Miroir de COURIER_TRANSITIONS côté API ; le serveur reste la référence. */
export const COURIER_TRANSITIONS: Readonly<Record<DeliveryStatus, readonly CourierAction[]>> = {
  pending: [],
  assigned: ['picked_up', 'failed'],
  picked_up: ['in_transit', 'failed'],
  in_transit: ['delivered', 'failed'],
  delivered: [],
  failed: ['returned'],
  returned: [],
};

export const courierActions = (status: DeliveryStatus): CourierAction[] => [...COURIER_TRANSITIONS[status]];

/** La position ne se partage que pendant le trajet. */
export const canShareLocation = (status: DeliveryStatus): boolean => status === 'in_transit';

export const isFinalStatus = (status: DeliveryStatus): boolean => status === 'delivered' || status === 'failed' || status === 'returned';

/** Étapes de la frise acheteur (hors échec). */
export const DELIVERY_STEPS: readonly DeliveryStatus[] = ['pending', 'assigned', 'picked_up', 'in_transit', 'delivered'];

export type StepState = 'done' | 'current' | 'todo';

/** État de chaque étape pour un statut ; `failed` / `returned` ne coche aucune étape courante. */
export function stepStates(status: DeliveryStatus): { step: DeliveryStatus; state: StepState }[] {
  const idx = DELIVERY_STEPS.indexOf(status);
  return DELIVERY_STEPS.map((step, i) => ({
    step,
    state: idx === -1 ? 'todo' : i < idx ? 'done' : i === idx ? (status === 'delivered' ? 'done' : 'current') : 'todo',
  }));
}

export const canRate = (status: DeliveryStatus, rating: number | null): boolean => status === 'delivered' && rating === null;

/** Code saisi par le livreur : 6 chiffres. */
export const isCompleteCode = (code: string): boolean => /^\d{6}$/.test(code);

/** Code masqué ou « 482 913 ». */
export function formatProofCode(code: string, revealed: boolean): string {
  if (!revealed) return '•••  •••';
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/* ------------------------------------------------------------------ distance (acheteur) */

export interface LatLngLike {
  lat: number;
  lng: number;
}

/** Distance à vol d'oiseau en km (haversine). */
export function distanceKm(a: LatLngLike, b: LatLngLike): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ------------------------------------------------------------------ minuterie de position */

export const LOCATION_INTERVAL_MS = 30_000;

export interface LocationPumpDeps {
  /** Position courante de l'appareil ; null si indisponible (rien n'est envoyé ce tour-ci). */
  getPosition(): Promise<LatLngLike | null>;
  send(p: LatLngLike): Promise<void>;
  /** Erreur d'envoi définitive (consentement retiré, hors trajet) : la minuterie s'arrête. */
  shouldStop?(err: unknown): boolean;
  onStop?(err: unknown): void;
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/**
 * Envoi périodique de la position : un envoi immédiat au démarrage, puis un toutes les 30 s.
 * Jamais deux envois en parallèle ; aucune position n'est mémorisée.
 */
export function createLocationPump(deps: LocationPumpDeps) {
  const every = deps.intervalMs ?? LOCATION_INTERVAL_MS;
  const set = deps.setTimer ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clear = deps.clearTimer ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  let handle: unknown = null;
  let busy = false;
  let running = false;

  async function tick() {
    if (busy || !running) return;
    busy = true;
    try {
      const p = await deps.getPosition();
      if (p && running) await deps.send(p);
    } catch (err) {
      if (deps.shouldStop?.(err)) {
        stop();
        deps.onStop?.(err);
      }
    } finally {
      busy = false;
    }
  }

  function start() {
    if (running) return;
    running = true;
    void tick();
    handle = set(() => void tick(), every);
  }
  function stop() {
    running = false;
    if (handle !== null) clear(handle);
    handle = null;
  }
  return { start, stop, isRunning: () => running };
}
