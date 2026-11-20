import { describe, expect, it } from 'vitest';
import { amountPoints, barHeights, canCancel, canDecide, describeApproval, displayStatus, remainingHours, shortDay, splitApprovals, summarizeSeries } from './logic';

describe('graphique en barres', () => {
  it('met le maximum à pleine hauteur, garde une barre visible pour une petite valeur et 0 pour zéro', () => {
    expect(barHeights([0, 50, 100], 80)).toEqual([0, 40, 80]);
    expect(barHeights([1, 1000], 80)).toEqual([2, 80]);
    expect(barHeights([0, 0, 0])).toEqual([0, 0, 0]);
    expect(barHeights([])).toEqual([]);
  });

  it('résume une série pour la lecture à voix haute', () => {
    const s = summarizeSeries([{ day: '2026-03-01', value: 2 }, { day: '2026-03-02', value: 0 }, { day: '2026-03-03', value: 5 }, { day: '2026-03-04', value: 5 }]);
    expect(s).toEqual({ total: 12, max: 5, maxDay: '2026-03-04', average: 3 });
    expect(summarizeSeries([{ day: '2026-03-01', value: 0 }])).toEqual({ total: 0, max: 0, maxDay: null, average: 0 });
    expect(summarizeSeries([])).toEqual({ total: 0, max: 0, maxDay: null, average: 0 });
    expect(shortDay('2026-03-04')).toBe('04/03');
    expect(shortDay(null)).toBe('–');
    expect(amountPoints([{ day: '2026-03-01', amountMinor: 7 }])).toEqual([{ day: '2026-03-01', value: 7 }]);
  });
});

const NOW = Date.parse('2026-03-02T12:00:00Z');
const base = { requestedBy: 'a', expiresAt: '2026-03-03T10:00:00.000Z', status: 'pending' as const };

describe('double validation', () => {
  it('décrit chaque type de demande à partir des ids et réglages', () => {
    expect(describeApproval({ kind: 'flag.regulated.change', subjectId: 'betting', payload: { key: 'betting', patch: { enabled: true } } })).toEqual({ name: 'betting', state: 'on' });
    expect(describeApproval({ kind: 'flag.regulated.change', subjectId: 'betting', payload: { key: 'betting', patch: { enabled: false } } }).state).toBe('off');
    expect(describeApproval({ kind: 'ledger.account.freeze', subjectId: '12345678-aaaa', payload: { frozen: false } })).toEqual({ name: '12345678', state: 'active' });
    expect(describeApproval({ kind: 'ledger.account.freeze', subjectId: '12345678-aaaa', payload: { frozen: true } }).state).toBe('frozen');
    expect(describeApproval({ kind: 'user.platform_role.grant', subjectId: '87654321-bbbb', payload: { role: 'moderator' } })).toEqual({ name: '87654321', state: 'moderator' });
    expect(describeApproval({ kind: 'user.suspend.staff', subjectId: null, payload: {} })).toEqual({ name: '–', state: 'suspended' });
  });

  it('seul un autre administrateur décide, seul l’auteur annule, jamais après l’échéance', () => {
    expect(canDecide(base, 'b', NOW)).toBe(true);
    expect(canDecide(base, 'a', NOW)).toBe(false);
    expect(canDecide(base, undefined, NOW)).toBe(false);
    expect(canCancel(base, 'a', NOW)).toBe(true);
    expect(canCancel(base, 'b', NOW)).toBe(false);
    const late = { ...base, expiresAt: '2026-03-02T11:59:59.000Z' };
    expect(canDecide(late, 'b', NOW)).toBe(false);
    expect(canCancel(late, 'a', NOW)).toBe(false);
    expect(canDecide({ ...base, status: 'executed' as const }, 'b', NOW)).toBe(false);
    expect(displayStatus(late, NOW)).toBe('expired');
    expect(displayStatus(base, NOW)).toBe('pending');
  });

  it('compte les heures restantes et sépare en attente et historique', () => {
    expect(remainingHours('2026-03-03T10:00:00.000Z', NOW)).toBe(22);
    expect(remainingHours('2026-03-03T10:00:01.000Z', NOW)).toBe(23);
    expect(remainingHours('2026-03-01T10:00:00.000Z', NOW)).toBe(0);
    const items = [base, { ...base, status: 'rejected' as const }, { ...base, expiresAt: '2026-03-01T00:00:00.000Z' }];
    const { pending, history } = splitApprovals(items, NOW);
    expect(pending).toHaveLength(1);
    expect(history).toHaveLength(2);
  });
});
