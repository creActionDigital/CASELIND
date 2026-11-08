import type { WalletTransaction } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { parseWalletAmount, topupMaxMinor } from './amount';
import { classifyWalletError, failureMessage } from './errors';
import { dayKeyOf, flattenGroups, groupByDay, signedMinor } from './history';
import { appendDigit, checkPin, validatePinForm } from './pin';
import { parsePrefs } from './prefs-logic';
import { walletTarget } from './routing';

describe('saisie décimale vers unités mineures', () => {
  it('convertit sans flottant', () => {
    expect(parseWalletAmount('12,50', 'USD')).toEqual({ minor: 1250 });
    expect(parseWalletAmount('0.29', 'USD')).toEqual({ minor: 29 });
    expect(parseWalletAmount('1', 'CDF')).toEqual({ minor: 100 });
  });
  it('refuse vide, zéro, négatif, trop de décimales', () => {
    for (const bad of ['', '0', '-5', 'abc', '1.234']) expect(parseWalletAmount(bad, 'USD')).toEqual({ issue: 'invalid' });
  });
  it('applique le plafond de recharge', () => {
    expect(parseWalletAmount('100', 'USD', topupMaxMinor('USD'))).toEqual({ minor: 10000 });
    expect(parseWalletAmount('100,01', 'USD', topupMaxMinor('USD'))).toEqual({ issue: 'too_high' });
    expect(topupMaxMinor('CDF')).toBe(28_000_000);
  });
});

describe('PIN', () => {
  it('accepte un code correct', () => expect(checkPin('135790')).toBe('ok'));
  it('refuse longueur et caractères', () => {
    expect(checkPin('12345')).toBe('length');
    expect(checkPin('12345a')).toBe('length');
  });
  it('refuse suites et répétitions', () => {
    for (const w of ['123456', '654321', '111111', '121212', '123123']) expect(checkPin(w)).toBe('weak');
  });
  it('limite la saisie du pavé', () => {
    expect(appendDigit('12345', '6')).toBe('123456');
    expect(appendDigit('123456', '7')).toBe('123456');
    expect(appendDigit('1', 'x')).toBe('1');
  });
  it('valide le formulaire', () => {
    expect(validatePinForm('135790', '135790', 'pw')).toBeNull();
    expect(validatePinForm('135790', '135791', 'pw')).toBe('mismatch');
    expect(validatePinForm('135790', '135790', '')).toBe('password');
    expect(validatePinForm('111111', '111111', 'pw')).toBe('weak');
  });
});

const err = (status: number, code: string, message: string, details?: unknown) => new ApiRequestError(status, code, message, details);
const tr = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${JSON.stringify(p)}` : k);

describe('raisons de refus', () => {
  it('classe par details.reason', () => {
    expect(classifyWalletError(err(409, 'conflict', 'x', { reason: 'insufficient_funds' }))).toEqual({ kind: 'insufficient_funds' });
    expect(classifyWalletError(err(409, 'conflict', 'x', { reason: 'pin_not_set' }))).toEqual({ kind: 'pin_not_set' });
    expect(classifyWalletError(err(409, 'conflict', 'x', { reason: 'limit_exceeded', limitMinor: 5000 }))).toEqual({ kind: 'limit_exceeded', limitMinor: 5000 });
    expect(classifyWalletError(err(403, 'forbidden', 'x', { reason: 'pin_invalid', attemptsRemaining: 3 }))).toEqual({ kind: 'pin_invalid', attemptsRemaining: 3 });
  });
  it('retombe sur le statut HTTP', () => {
    expect(classifyWalletError(err(403, 'forbidden', 'Incorrect PIN'))).toEqual({ kind: 'pin_invalid', attemptsRemaining: undefined });
    expect(classifyWalletError(err(403, 'forbidden', 'An account involved is frozen'))).toEqual({ kind: 'account_frozen' });
    expect(classifyWalletError(err(404, 'not_found', 'Recipient not found'))).toEqual({ kind: 'recipient_not_found' });
    expect(classifyWalletError(err(400, 'validation_failed', 'You cannot send money to yourself'))).toEqual({ kind: 'self_transfer' });
    expect(classifyWalletError(new Error('x'))).toEqual({ kind: 'other' });
  });
  it('calcule la durée du verrou', () => {
    const now = Date.parse('2026-01-01T10:00:00Z');
    const until = '2026-01-01T10:15:00Z';
    expect(classifyWalletError(err(423, 'account_locked', 'x', { reason: 'pin_locked', lockedUntil: until }), now)).toEqual({ kind: 'pin_locked', minutes: 15 });
    expect(classifyWalletError(err(423, 'account_locked', 'x', { reason: 'pin_locked', retryAfterSeconds: 90 }), now)).toEqual({ kind: 'pin_locked', minutes: 2 });
    expect(classifyWalletError(err(423, 'account_locked', 'x'), now)).toEqual({ kind: 'pin_locked', minutes: undefined });
  });
  it('traduit', () => {
    const fmt = (m: number) => `$${m}`;
    expect(failureMessage({ kind: 'limit_exceeded', limitMinor: 5000 }, tr as never, fmt)).toBe('wallet.error.limit:{"limit":"$5000"}');
    expect(failureMessage({ kind: 'pin_invalid', attemptsRemaining: 2 }, tr as never, fmt)).toBe('wallet.error.pinInvalid:{"n":2}');
    expect(failureMessage({ kind: 'pin_locked', minutes: 15 }, tr as never, fmt)).toBe('wallet.error.pinLocked:{"n":15}');
    expect(failureMessage({ kind: 'pin_locked' }, tr as never, fmt)).toBe('wallet.error.pinLockedGeneric');
    expect(failureMessage({ kind: 'other' }, tr as never, fmt)).toBeNull();
  });
});

const tx = (id: string, iso: string, direction: 'in' | 'out' = 'in'): WalletTransaction => ({
  id,
  kind: 'p2p',
  direction,
  amountMinor: 500,
  currency: 'USD',
  counterparty: null,
  note: null,
  createdAt: iso,
});

describe('historique par jour', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0);
  const at = (d: number, h: number) => new Date(2026, 5, d, h).toISOString();
  it('regroupe en conservant l ordre et marque aujourd hui / hier', () => {
    const groups = groupByDay([tx('a', at(15, 10)), tx('b', at(15, 8)), tx('c', at(14, 20)), tx('d', at(10, 9))], now);
    expect(groups.map((g) => [g.relative, g.items.map((i) => i.id)])).toEqual([
      ['today', ['a', 'b']],
      ['yesterday', ['c']],
      [null, ['d']],
    ]);
    expect(groups[2]!.dayKey).toBe(dayKeyOf(new Date(2026, 5, 10)));
  });
  it('aplatit en en-têtes et lignes, signe le montant', () => {
    const rows = flattenGroups(groupByDay([tx('a', at(15, 10)), tx('c', at(14, 20), 'out')], now));
    expect(rows.map((r) => r.type)).toEqual(['header', 'item', 'header', 'item']);
    expect(signedMinor(tx('x', at(1, 1), 'out'))).toBe(-500);
    expect(signedMinor(tx('x', at(1, 1)))).toBe(500);
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('préférences et routage', () => {
  it('masque par défaut et valide la devise', () => {
    expect(parsePrefs(null)).toEqual({ hidden: true, currency: 'USD' });
    expect(parsePrefs('{"hidden":false,"currency":"CDF"}')).toEqual({ hidden: false, currency: 'CDF' });
    expect(parsePrefs('{"currency":"cdf"}').currency).toBe('USD');
    expect(parsePrefs('pas du json')).toEqual({ hidden: true, currency: 'USD' });
  });
  it('route une notification payment', () => {
    expect(walletTarget({ transferId: 't1' })).toEqual({ pathname: '/wallet', params: { tx: 't1' } });
    expect(walletTarget({ orgId: 'o1', transferId: 't1' })).toEqual({ pathname: '/seller/[orgId]/wallet', params: { orgId: 'o1' } });
    expect(walletTarget({})).toEqual({ pathname: '/wallet' });
  });
});

import { inPeriod } from './history';
describe('périodes d’activité', () => {
  const now = new Date(2026, 5, 15, 12);
  it('filtre semaine, mois, année', () => {
    expect(inPeriod(new Date(2026, 5, 12).toISOString(), 'week', now)).toBe(true);
    expect(inPeriod(new Date(2026, 5, 1).toISOString(), 'week', now)).toBe(false);
    expect(inPeriod(new Date(2026, 5, 1).toISOString(), 'month', now)).toBe(true);
    expect(inPeriod(new Date(2026, 4, 30).toISOString(), 'month', now)).toBe(false);
    expect(inPeriod(new Date(2026, 0, 2).toISOString(), 'year', now)).toBe(true);
    expect(inPeriod(new Date(2025, 11, 31).toISOString(), 'year', now)).toBe(false);
  });
});
