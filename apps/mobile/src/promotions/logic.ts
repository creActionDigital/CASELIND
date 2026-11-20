import type { CreatePromotionRequest, PromotionKind } from '@caselind/contracts';
import { parseDecimalToMinor } from '../seller/money';
import { parseDateTime } from '../vitrine/updates-logic';

const DAY = 86_400_000;
/** Même plafond que le serveur (PROMOTION_MAX_DAYS). */
const MAX_DAYS = 30;

/** Pourcentage de réduction affiché (« -20 % ») ; null sans vraie réduction. Jamais 0 ni 100. */
export function discountPercent(compareAtMinor: number | null | undefined, priceMinor: number): number | null {
  if (!compareAtMinor || compareAtMinor <= priceMinor || priceMinor < 0) return null;
  return Math.min(99, Math.max(1, Math.round((1 - priceMinor / compareAtMinor) * 100)));
}

export interface Countdown {
  days: number;
  /** « HH:MM:SS » */
  clock: string;
}

const two = (n: number) => String(n).padStart(2, '0');

/** Temps restant avant `endsAt` ; null quand c'est fini (ou la date est invalide). Les secondes sont arrondies au-dessus. */
export function countdown(endsAt: string, nowMs: number): Countdown | null {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end) || end <= nowMs) return null;
  const total = Math.ceil((end - nowMs) / 1000);
  const days = Math.floor(total / 86_400);
  const rest = total % 86_400;
  return { days, clock: `${two(Math.floor(rest / 3600))}:${two(Math.floor((rest % 3600) / 60))}:${two(rest % 60)}` };
}

export interface PromotionForm {
  productId: string;
  /** Vide = tout le produit. */
  variantId: string;
  kind: PromotionKind;
  /** percent : entier 1-90 ; fixed_price : montant décimal dans la devise. */
  value: string;
  label: string;
  /** « AAAA-MM-JJ HH:MM » ; vide = maintenant. */
  startsAt: string;
  endsAt: string;
  /** Vide = sans plafond. */
  stockCap: string;
  currency: string;
  /** Prix courant le plus bas visé (unités mineures), pour refuser un prix fixe qui n'est pas une baisse ; 0 = inconnu. */
  basePriceMinor: number;
}

export const emptyPromotionForm = (): PromotionForm => ({
  productId: '',
  variantId: '',
  kind: 'percent',
  value: '',
  label: '',
  startsAt: '',
  endsAt: '',
  stockCap: '',
  currency: 'USD',
  basePriceMinor: 0,
});

export type PromotionFormError = 'product' | 'value' | 'valueFixed' | 'label' | 'startsAt' | 'endsAt' | 'endBeforeStart' | 'tooLong' | 'past' | 'cap';

/** Valide le formulaire comme le serveur et construit la requête ; le prix n'est jamais calculé ici. */
export function buildPromotion(f: PromotionForm, now = Date.now()): { ok: CreatePromotionRequest } | { error: PromotionFormError } {
  if (!f.productId) return { error: 'product' };
  const label = f.label.trim();
  if (label.length < 1 || label.length > 40) return { error: 'label' };
  let value: number;
  if (f.kind === 'percent') {
    value = /^\d{1,2}$/.test(f.value.trim()) ? Number(f.value.trim()) : 0;
    if (value < 1 || value > 90) return { error: 'value' };
  } else {
    const minor = parseDecimalToMinor(f.value, f.currency);
    if (minor === null) return { error: 'value' };
    if (f.basePriceMinor > 0 && minor >= f.basePriceMinor) return { error: 'valueFixed' };
    value = minor;
  }
  const start = f.startsAt.trim() ? parseDateTime(f.startsAt) : new Date(now);
  if (!start) return { error: 'startsAt' };
  const end = parseDateTime(f.endsAt);
  if (!end) return { error: 'endsAt' };
  if (end.getTime() <= start.getTime()) return { error: 'endBeforeStart' };
  if (end.getTime() - start.getTime() > MAX_DAYS * DAY) return { error: 'tooLong' };
  if (end.getTime() <= now) return { error: 'past' };
  let stockCap: number | undefined;
  if (f.stockCap.trim()) {
    if (!/^\d{1,7}$/.test(f.stockCap.trim()) || Number(f.stockCap) < 1) return { error: 'cap' };
    stockCap = Number(f.stockCap);
  }
  return {
    ok: {
      productId: f.productId,
      variantId: f.variantId || null,
      kind: f.kind,
      value,
      label,
      ...(f.startsAt.trim() ? { startsAt: start.toISOString() } : {}),
      endsAt: end.toISOString(),
      ...(stockCap ? { stockCap } : {}),
    },
  };
}
