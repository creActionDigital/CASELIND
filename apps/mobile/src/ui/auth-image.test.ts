import { describe, expect, it, vi } from 'vitest';

// AuthImage pulls React Native and expo-image; only the pure helper is under test here.
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('react-native', () => ({ ActivityIndicator: () => null, StyleSheet: { create: (s: unknown) => s, absoluteFill: {} }, View: () => null }));
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock('../media/auth-media', () => ({ getAuthMediaUri: vi.fn() }));
vi.mock('../theme/use-theme', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('./Text', () => ({ Text: () => null }));

const { initialsOf } = await import('./AuthImage');

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Goma Market')).toBe('GM');
    expect(initialsOf('  café du lac de Kivu ')).toBe('CD');
  });

  it('handles a single word and an empty label', () => {
    expect(initialsOf('bob')).toBe('B');
    expect(initialsOf('')).toBe('');
  });
});
