import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parsePrefs, resolveDark } from './logic';

describe('parsePrefs', () => {
  it('retombe sur les valeurs par défaut si vide ou illisible', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{pas du json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('42')).toEqual(DEFAULT_PREFS);
  });
  it('garde les valeurs valides et écarte les autres', () => {
    const p = parsePrefs(JSON.stringify({ onboardingDone: true, locale: 'sw', country: 'CD', theme: 'dark', profileSetupPending: true }));
    expect(p).toEqual({ onboardingDone: true, locale: 'sw', country: 'CD', theme: 'dark', profileSetupPending: true });
    const q = parsePrefs(JSON.stringify({ onboardingDone: 'oui', locale: 'de', country: 'cd', theme: 'rose' }));
    expect(q).toEqual(DEFAULT_PREFS);
  });
});

describe('resolveDark', () => {
  it('suit le système seulement en mode système', () => {
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
    expect(resolveDark('light', true)).toBe(false);
    expect(resolveDark('dark', false)).toBe(true);
  });
});
