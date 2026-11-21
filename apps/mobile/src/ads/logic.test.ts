import { describe, expect, it } from 'vitest';
import { budgetRange, checkCampaignForm, cpcMinor, ctrPercent, isoDay, parseInterests } from './logic';

const ok = { name: 'Promo', hasTarget: true, budget: '10', daily: '5', currency: 'USD', startsOn: '2026-12-01', endsOn: '2026-12-08', placements: ['feed'] as const, minAge: '', country: '' };
const issueOf = (p: object): string => {
  const r = checkCampaignForm({ ...ok, ...p } as typeof ok, '2026-12-01');
  return 'issue' in r ? r.issue.key : 'ok';
};

describe('formulaire de campagne', () => {
  it('accepte un formulaire valide et renvoie les montants mineurs', () => {
    expect(checkCampaignForm(ok, '2026-12-01')).toEqual({ budgetMinor: 1000, dailyMinor: 500 });
  });
  it('refuse nom, cible, budget, budget quotidien, dates, emplacements, âge et pays invalides', () => {
    expect(issueOf({ name: ' a ' })).toBe('name');
    expect(issueOf({ hasTarget: false })).toBe('target');
    expect(issueOf({ budget: '1' })).toBe('budget');
    expect(issueOf({ budget: 'abc' })).toBe('budget');
    expect(issueOf({ daily: '50' })).toBe('daily');
    expect(issueOf({ daily: '0.05' })).toBe('daily');
    expect(issueOf({ startsOn: '2026-11-30' })).toBe('dates');
    expect(issueOf({ endsOn: '2026-11-30' })).toBe('dates');
    expect(issueOf({ endsOn: '2027-06-01' })).toBe('dates');
    expect(issueOf({ placements: [] })).toBe('placements');
    expect(issueOf({ minAge: '12' })).toBe('age');
    expect(issueOf({ country: 'COD' })).toBe('country');
  });
  it('met les bornes à l’échelle du franc congolais', () => {
    expect(budgetRange('USD')).toEqual({ min: 500, max: 1_000_000 });
    expect(budgetRange('CDF').min).toBe(1_400_000);
    expect(cpcMinor('CDF')).toBe(28_000);
  });
  it('outils : intérêts, taux de clic, jours', () => {
    expect(parseInterests(' mode, sport ,mode,,')).toEqual(['mode', 'sport']);
    expect(ctrPercent(200, 5)).toBe('2.5');
    expect(ctrPercent(0, 0)).toBe('0.0');
    expect(isoDay(1, Date.parse('2026-12-31T10:00:00Z'))).toBe('2027-01-01');
  });
});
