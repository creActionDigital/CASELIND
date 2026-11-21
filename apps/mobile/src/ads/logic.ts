import type { AdPlacement, AdStatus } from '@caselind/contracts';
import { parseDecimalToMinor } from '../seller/money';

export const AD_PLACEMENTS: readonly AdPlacement[] = ['feed', 'videos', 'marketplace', 'search'];
export const AD_STATUSES: readonly AdStatus[] = ['pending', 'approved', 'paused', 'rejected', 'stopped', 'ended'];

const CDF_PER_USD = 2800;
// Mêmes bornes que le serveur (packages/contracts/src/monetization.ts).
export const COST_PER_CLICK_USD_MINOR = 10;
const MIN_BUDGET_USD_MINOR = 500;
const MAX_BUDGET_USD_MINOR = 1_000_000;
const MAX_DAYS = 90;

const scale = (usdMinor: number, currency: string): number => usdMinor * (currency === 'CDF' ? CDF_PER_USD : 1);
export const cpcMinor = (currency: string): number => scale(COST_PER_CLICK_USD_MINOR, currency);
export const budgetRange = (currency: string): { min: number; max: number } => ({
  min: scale(MIN_BUDGET_USD_MINOR, currency),
  max: scale(MAX_BUDGET_USD_MINOR, currency),
});

/** Jour UTC `AAAA-MM-JJ`, décalé de `offset` jours. */
export const isoDay = (offset = 0, from: number = Date.now()): string => new Date(from + offset * 86_400_000).toISOString().slice(0, 10);

export const parseInterests = (input: string): string[] =>
  [...new Set(input.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 10).map((s) => s.slice(0, 30));

export const ctrPercent = (impressions: number, clicks: number): string => (impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : '0.0');

export interface CampaignForm {
  name: string;
  hasTarget: boolean;
  budget: string;
  daily: string;
  currency: string;
  startsOn: string;
  endsOn: string;
  placements: readonly AdPlacement[];
  minAge: string;
  country: string;
}

export type FormIssue = { key: 'name' | 'target' | 'budget' | 'daily' | 'dates' | 'placements' | 'age' | 'country'; min?: number; max?: number };

/** Premier problème du formulaire (ou les montants valides) ; le serveur reste la référence. */
export function checkCampaignForm(f: CampaignForm, today: string = isoDay()): { issue: FormIssue } | { budgetMinor: number; dailyMinor: number } {
  if (f.name.trim().length < 2) return { issue: { key: 'name' } };
  if (!f.hasTarget) return { issue: { key: 'target' } };
  const { min, max } = budgetRange(f.currency);
  const budgetMinor = parseDecimalToMinor(f.budget, f.currency);
  if (budgetMinor === null || budgetMinor < min || budgetMinor > max) return { issue: { key: 'budget', min, max } };
  const dailyMinor = parseDecimalToMinor(f.daily, f.currency);
  if (dailyMinor === null || dailyMinor < cpcMinor(f.currency) || dailyMinor > budgetMinor) return { issue: { key: 'daily', min: cpcMinor(f.currency) } };
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(f.startsOn) || !re.test(f.endsOn) || f.startsOn < today || f.endsOn < f.startsOn || Date.parse(f.endsOn) - Date.parse(f.startsOn) > MAX_DAYS * 86_400_000) {
    return { issue: { key: 'dates' } };
  }
  if (f.placements.length === 0) return { issue: { key: 'placements' } };
  if (f.minAge.trim() !== '' && !(Number.isInteger(Number(f.minAge)) && Number(f.minAge) >= 13 && Number(f.minAge) <= 99)) return { issue: { key: 'age' } };
  if (f.country.trim() !== '' && !/^[A-Za-z]{2}$/.test(f.country.trim())) return { issue: { key: 'country' } };
  return { budgetMinor, dailyMinor };
}
