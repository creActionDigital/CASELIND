import { describe, expect, it } from 'vitest';
import { formatDuration, phaseFromIce, shouldCreateOffer, shouldRestartIce, splitSignals } from './call-machine';

describe('phaseFromIce', () => {
  it('connecte, puis reconnecte, puis échoue', () => {
    expect(phaseFromIce('connecting', 'checking')).toBe('connecting');
    expect(phaseFromIce('connecting', 'connected')).toBe('connected');
    expect(phaseFromIce('connected', 'disconnected')).toBe('reconnecting');
    expect(phaseFromIce('reconnecting', 'checking')).toBe('reconnecting');
    expect(phaseFromIce('reconnecting', 'completed')).toBe('connected');
    expect(phaseFromIce('connected', 'failed')).toBe('failed');
    expect(phaseFromIce('connected', 'closed')).toBe('closed');
  });
  it('une coupure avant la première connexion reste « connexion »', () => {
    expect(phaseFromIce('connecting', 'disconnected')).toBe('connecting');
  });
});

describe('rôles', () => {
  it("seul l'appelant crée l'offre, quand l'appel est actif", () => {
    expect(shouldCreateOffer(true, 'active')).toBe(true);
    expect(shouldCreateOffer(true, 'ringing')).toBe(false);
    expect(shouldCreateOffer(false, 'active')).toBe(false);
  });
  it('relance ICE bornée', () => {
    expect(shouldRestartIce(true, 'failed', 0)).toBe(true);
    expect(shouldRestartIce(true, 'failed', 2)).toBe(false);
    expect(shouldRestartIce(false, 'failed', 0)).toBe(false);
    expect(shouldRestartIce(true, 'connected', 0)).toBe(false);
  });
});

describe('formatDuration', () => {
  it('mm:ss puis h:mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-3)).toBe('00:00');
  });
});

describe('splitSignals', () => {
  const q = [
    { type: 'ice' as const, payload: 'a' },
    { type: 'offer' as const, payload: 'o' },
  ];
  it('garde les candidats tant que la description distante manque', () => {
    expect(splitSignals(q, false)).toEqual({ now: [q[1]], later: [q[0]] });
    expect(splitSignals(q, true)).toEqual({ now: q, later: [] });
  });
});
