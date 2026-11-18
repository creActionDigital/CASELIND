import type { ForwardResult, Message, SystemEvent } from '@caselind/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { MessagePages } from './cache';
import {
  canSetDisappearing,
  checkSchedule,
  createDebouncer,
  nextExpiryDelay,
  parseLocalDateTime,
  removeExpired,
  shouldApplyRemoteDraft,
  summarizeForward,
  toggleDestination,
} from './extras-logic';
import { systemText } from './system-text';

const CONV = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';

function msg(id: string, expiresAt: string | null): Message {
  return {
    id,
    conversationId: CONV,
    seq: 1,
    kind: 'text',
    senderId: ME,
    clientId: null,
    body: 'x',
    media: null,
    replyToId: null,
    mentions: [],
    systemEvent: null,
    recalled: false,
    reactions: [],
    myReaction: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    forwarded: false,
    expiresAt,
    favorited: false,
    poll: null,
  };
}
const pages = (items: Message[]): MessagePages => ({ pages: [{ items, hasMore: false }], pageParams: [undefined] });

describe('expiration locale', () => {
  const now = Date.parse('2026-01-01T12:00:00.000Z');
  it('retire les messages expirés et garde les autres', () => {
    const data = pages([msg('a', '2026-01-01T11:59:59.000Z'), msg('b', '2026-01-01T13:00:00.000Z'), msg('c', null)]);
    const out = removeExpired(data, now)!;
    expect(out.pages[0].items.map((m) => m.id)).toEqual(['b', 'c']);
  });
  it('conserve la référence quand rien n’expire', () => {
    const data = pages([msg('b', '2026-01-01T13:00:00.000Z')]);
    expect(removeExpired(data, now)).toBe(data);
  });
  it('délai jusqu’à la prochaine expiration, borné pour setTimeout', () => {
    expect(nextExpiryDelay([msg('a', null)], now)).toBeNull();
    expect(nextExpiryDelay([msg('a', '2026-01-01T12:00:10.000Z'), msg('b', '2026-01-01T12:05:00.000Z')], now)).toBe(10_050);
    expect(nextExpiryDelay([msg('a', '2026-01-01T11:00:00.000Z')], now)).toBe(0);
    expect(nextExpiryDelay([msg('a', '2027-01-01T00:00:00.000Z')], now)).toBe(2 ** 31 - 1);
  });
});

describe('message programmé', () => {
  const now = Date.parse('2026-01-01T12:00:00.000Z');
  it('bornes de 1 minute à 30 jours', () => {
    expect(checkSchedule(new Date(now + 59_000), now)).toBe('too_soon');
    expect(checkSchedule(new Date(now + 60_000), now)).toBe('ok');
    expect(checkSchedule(new Date(now + 30 * 86400_000), now)).toBe('ok');
    expect(checkSchedule(new Date(now + 30 * 86400_000 + 1000), now)).toBe('too_far');
    expect(checkSchedule(null, now)).toBe('invalid');
  });
  it('analyse la date et l’heure locales', () => {
    const d = parseLocalDateTime('2026-03-05', '9:30')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 2, 5, 9, 30]);
    expect(parseLocalDateTime('2026-02-31', '10:00')).toBeNull();
    expect(parseLocalDateTime('2026-03-05', '24:00')).toBeNull();
    expect(parseLocalDateTime('demain', '10:00')).toBeNull();
  });
});

describe('brouillon', () => {
  it('anti-rebond : seule la dernière valeur est enregistrée après 800 ms', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const d = createDebouncer(save, 800);
    d.call('a');
    vi.advanceTimersByTime(500);
    d.call('ab');
    vi.advanceTimersByTime(799);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('ab');
    expect(d.pending()).toBe(false);
    vi.useRealTimers();
  });
  it('flush livre tout de suite, cancel abandonne', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const d = createDebouncer(save, 800);
    d.call('x');
    d.flush();
    expect(save).toHaveBeenCalledWith('x');
    d.call('y');
    d.cancel();
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('un brouillon distant ne remplace pas la saisie en cours', () => {
    const base = { remote: 'depuis mobile 2', current: '', lastSaved: null, hasPendingSave: false };
    expect(shouldApplyRemoteDraft(base)).toBe(true);
    expect(shouldApplyRemoteDraft({ ...base, hasPendingSave: true })).toBe(false);
    expect(shouldApplyRemoteDraft({ ...base, current: 'depuis mobile 2' })).toBe(false);
    expect(shouldApplyRemoteDraft({ ...base, current: 'tapé depuis', lastSaved: 'depuis mobile 2' })).toBe(false);
    expect(shouldApplyRemoteDraft({ remote: null, current: 'reste', lastSaved: 'reste', hasPendingSave: false })).toBe(true);
    expect(shouldApplyRemoteDraft({ remote: null, current: 'reste', lastSaved: null, hasPendingSave: false })).toBe(false);
  });
});

describe('texte du message système', () => {
  const names: Record<string, string> = { [ME]: 'Amina' };
  const name = (id: string | null) => (id ? (names[id] ?? '?') : '?');
  const dict: Record<string, string> = {
    'chat.system.disappearing_on': '{name} a activé les messages éphémères : {duration}',
    'chat.system.disappearing_off': '{name} a désactivé les messages éphémères',
    'messagesX.duration.604800': '7 jours',
    'messagesX.duration.days': '{n} jours',
  };
  const t = (key: string, p?: Record<string, string | number>) =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(p?.[k] ?? ''));
  const ev = (seconds: number | null): SystemEvent => ({ type: 'disappearing_changed', userId: null, actorId: ME, title: null, seconds });
  it('active avec durée', () => {
    expect(systemText(ev(604800), name, t as never)).toBe('Amina a activé les messages éphémères : 7 jours');
    expect(systemText(ev(172800), name, t as never)).toBe('Amina a activé les messages éphémères : 2 jours');
  });
  it('désactive', () => {
    expect(systemText(ev(null), name, t as never)).toBe('Amina a désactivé les messages éphémères');
  });
});

describe('transfert', () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const res = (conversationId: string, ok: boolean): ForwardResult => ({
    conversationId,
    status: ok ? 'sent' : 'error',
    message: null,
    code: ok ? null : 'not_allowed',
  });
  it('agrège par destination dans l’ordre demandé', () => {
    const s = summarizeForward([A, B, C], [res(C, true), res(A, false), res(B, true)]);
    expect(s.sent).toEqual([B, C]);
    expect(s.failed).toEqual([A]);
    expect(s.allSent).toBe(false);
  });
  it('une destination absente de la réponse est impossible', () => {
    expect(summarizeForward([A, B], [res(A, true)]).failed).toEqual([B]);
  });
  it('limite à 10 destinations', () => {
    let sel: string[] = [];
    for (let i = 0; i < 12; i++) sel = toggleDestination(sel, `id${i}`);
    expect(sel).toHaveLength(10);
    expect(toggleDestination(sel, 'id0')).toHaveLength(9);
  });
});

describe('droits éphémères', () => {
  it('direct : tous ; groupe : admin et owner', () => {
    expect(canSetDisappearing({ kind: 'direct', myRole: 'member' })).toBe(true);
    expect(canSetDisappearing({ kind: 'group', myRole: 'member' })).toBe(false);
    expect(canSetDisappearing({ kind: 'group', myRole: 'admin' })).toBe(true);
    expect(canSetDisappearing({ kind: 'group', myRole: 'owner' })).toBe(true);
  });
});
