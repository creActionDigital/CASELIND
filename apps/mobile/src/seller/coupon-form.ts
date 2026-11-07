import type { CreateCouponRequest } from '@caselind/contracts';
import { parseDecimalToMinor } from './money';

export interface CouponDraft {
  code: string;
  kind: 'percent' | 'fixed';
  value: string;
  currency: string;
  min: string;
  startsAt: string; // AAAA-MM-JJ
  endsAt: string; // AAAA-MM-JJ
  maxUses: string;
  maxUsesPerUser: string;
}

export type CouponField = 'code' | 'value' | 'min' | 'startsAt' | 'endsAt' | 'maxUses' | 'maxUsesPerUser';
export type CouponErrors = Partial<Record<CouponField, 'invalid' | 'range'>>;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date AAAA-MM-JJ -> ISO en heure locale (début ou fin de journée) ; null si invalide. */
export function dayToIso(day: string, end: boolean): string | null {
  const m = DAY.exec(day.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = end ? new Date(y, mo - 1, d, 23, 59, 59) : new Date(y, mo - 1, d, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.toISOString();
}

const posInt = (s: string) => /^\d{1,9}$/.test(s.trim()) && Number(s) >= 1;

export function validateCoupon(d: CouponDraft): CouponErrors {
  const e: CouponErrors = {};
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(d.code.trim())) e.code = 'invalid';
  if (d.kind === 'percent') {
    if (!/^\d{1,2}$/.test(d.value.trim())) e.value = 'invalid';
    else if (Number(d.value) < 1 || Number(d.value) > 90) e.value = 'range';
  } else if (parseDecimalToMinor(d.value, d.currency) === null) e.value = 'invalid';
  if (d.min.trim() && parseDecimalToMinor(d.min, d.currency) === null) e.min = 'invalid';
  const s = d.startsAt.trim() ? dayToIso(d.startsAt, false) : undefined;
  const en = d.endsAt.trim() ? dayToIso(d.endsAt, true) : undefined;
  if (s === null) e.startsAt = 'invalid';
  if (en === null) e.endsAt = 'invalid';
  if (s && en && Date.parse(en) <= Date.parse(s)) e.endsAt = 'range';
  if (d.maxUses.trim() && !posInt(d.maxUses)) e.maxUses = 'invalid';
  if (d.maxUsesPerUser.trim() && !posInt(d.maxUsesPerUser)) e.maxUsesPerUser = 'invalid';
  return e;
}

/** Corps de POST /coupons ; à n'appeler que si `validateCoupon` ne renvoie aucune erreur. */
export function toCouponRequest(d: CouponDraft): CreateCouponRequest {
  const value = d.kind === 'percent' ? Number(d.value) : parseDecimalToMinor(d.value, d.currency)!;
  return {
    code: d.code.trim(),
    kind: d.kind,
    value,
    // Devise requise pour un montant fixe et pour tout minimum ; un pourcentage sans minimum vaut pour toutes les devises.
    ...(d.kind === 'fixed' || d.min.trim() ? { currency: d.currency } : {}),
    minOrderMinor: d.min.trim() ? parseDecimalToMinor(d.min, d.currency)! : 0,
    ...(d.startsAt.trim() ? { startsAt: dayToIso(d.startsAt, false)! } : {}),
    ...(d.endsAt.trim() ? { endsAt: dayToIso(d.endsAt, true)! } : {}),
    ...(d.maxUses.trim() ? { maxUses: Number(d.maxUses) } : {}),
    ...(d.maxUsesPerUser.trim() ? { maxUsesPerUser: Number(d.maxUsesPerUser) } : {}),
  };
}
