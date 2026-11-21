import { describe, expect, it } from 'vitest';
import { nextAction, toState } from './permissions-logic';

describe('permissions', () => {
  it('traduit la réponse Expo en état', () => {
    expect(toState(null)).toBe('unavailable');
    expect(toState({ status: 'granted' })).toBe('granted');
    expect(toState({ granted: true })).toBe('granted');
    expect(toState({ status: 'denied' })).toBe('denied');
    expect(toState({ status: 'undetermined' })).toBe('undetermined');
  });
  it('choisit l’action : demander, réglages après refus définitif, rien si accordé', () => {
    expect(nextAction('undetermined', true)).toBe('ask');
    expect(nextAction('denied', true)).toBe('ask');
    expect(nextAction('denied', false)).toBe('settings');
    expect(nextAction('granted', true)).toBe('none');
    expect(nextAction('unavailable', true)).toBe('none');
  });
});
