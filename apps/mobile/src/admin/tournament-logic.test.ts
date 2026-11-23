import { describe, expect, it } from 'vitest';
import { parseLocalDateTime, tournamentBody } from './tournament-logic';

describe('parseLocalDateTime', () => {
  it('accepte AAAA-MM-JJ HH:MM et renvoie de l’ISO', () => {
    const iso = parseLocalDateTime('2026-12-01 18:30');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    expect(new Date(iso as string).getHours()).toBe(18);
  });
  it('refuse les formats et les dates impossibles', () => {
    expect(parseLocalDateTime('01/12/2026')).toBeNull();
    expect(parseLocalDateTime('2026-02-31 10:00')).toBeNull();
    expect(parseLocalDateTime('2026-12-01 25:00')).toBeNull();
    expect(parseLocalDateTime('')).toBeNull();
  });
});

describe('tournamentBody', () => {
  it('exige titre, dates valides et fin après début', () => {
    expect(tournamentBody('Coupe du quiz', '2026-12-01 10:00', '2026-12-08 10:00')?.title).toBe('Coupe du quiz');
    expect(tournamentBody('  ', '2026-12-01 10:00', '2026-12-08 10:00')).toBeNull();
    expect(tournamentBody('X', '2026-12-08 10:00', '2026-12-01 10:00')).toBeNull();
    expect(tournamentBody('X', '2026-12-01 10:00', '2026-12-01 10:00')).toBeNull();
    expect(tournamentBody('x'.repeat(81), '2026-12-01 10:00', '2026-12-08 10:00')).toBeNull();
  });
});
