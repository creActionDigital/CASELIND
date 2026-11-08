import type { CreateDeliveryZoneRequest, DeliveryZone } from '@caselind/contracts';
import { minorToDecimalString, parseDecimalToMinor, SELLER_CURRENCIES } from '../seller/money';

export interface ZoneDraft {
  name: string;
  /** Villes ou quartiers séparés par des virgules ou des retours à la ligne. */
  areas: string;
  /** Frais par devise, en unités majeures ; vide = devise non livrée. */
  fees: Record<string, string>;
  eta: string;
  active: boolean;
}

export type ZoneField = 'name' | 'areas' | 'fees' | 'eta';
export type ZoneErrors = Partial<Record<ZoneField, 'invalid'>>;

export const emptyZoneDraft = (): ZoneDraft => ({ name: '', areas: '', fees: Object.fromEntries(SELLER_CURRENCIES.map((c) => [c, ''])), eta: '60', active: true });

export function zoneToDraft(z: DeliveryZone): ZoneDraft {
  const fees: Record<string, string> = {};
  for (const [cur, minor] of Object.entries(z.fees)) fees[cur] = minorToDecimalString(minor, cur);
  for (const c of SELLER_CURRENCIES) fees[c] ??= '';
  return { name: z.name, areas: z.areas.join(', '), fees, eta: String(z.etaMinutes), active: z.active };
}

export const splitAreas = (s: string): string[] => [...new Set(s.split(/[,;\n]/).map((a) => a.trim()).filter(Boolean))];

/** Frais en unités mineures ; « 0 » est permis (livraison offerte dans la zone). Null si invalide. */
export function parseFee(input: string, currency: string): number | null {
  const s = input.trim().replace(',', '.');
  if (/^0+(\.0*)?$/.test(s)) return 0;
  return parseDecimalToMinor(input, currency);
}

export function validateZone(d: ZoneDraft): ZoneErrors {
  const e: ZoneErrors = {};
  if (!d.name.trim() || d.name.trim().length > 80) e.name = 'invalid';
  const areas = splitAreas(d.areas);
  if (areas.length < 1 || areas.length > 50 || areas.some((a) => a.length > 80)) e.areas = 'invalid';
  const filled = Object.entries(d.fees).filter(([, v]) => v.trim() !== '');
  if (filled.length < 1 || filled.length > 10 || filled.some(([c, v]) => parseFee(v, c) === null)) e.fees = 'invalid';
  const eta = Number(d.eta);
  if (!/^\d{1,5}$/.test(d.eta.trim()) || eta < 5 || eta > 20160) e.eta = 'invalid';
  return e;
}

/** Corps de création ; à n'appeler que si `validateZone` ne renvoie aucune erreur. Le PATCH accepte le même corps. */
export function toZoneRequest(d: ZoneDraft): CreateDeliveryZoneRequest {
  const fees: Record<string, number> = {};
  for (const [c, v] of Object.entries(d.fees)) if (v.trim() !== '') fees[c] = parseFee(v, c)!;
  return { name: d.name.trim(), areas: splitAreas(d.areas), fees, etaMinutes: Number(d.eta), active: d.active };
}
