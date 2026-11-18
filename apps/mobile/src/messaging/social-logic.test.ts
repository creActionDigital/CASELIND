import { describe, expect, it } from 'vitest';
import {
  applyPollEvent,
  applyPresence,
  canClosePoll,
  cleanPollDraft,
  lastSeenWhen,
  nextVotes,
  optionPercent,
  presenceView,
  searchReady,
  totalVotes,
  withMyVotes,
} from './social-logic';

const poll = (over: Record<string, unknown> = {}) => ({
  question: 'Q',
  multiple: false,
  options: [
    { id: 'a', label: 'A', votes: 2 },
    { id: 'b', label: 'B', votes: 1 },
  ],
  voters: 3,
  closesAt: null,
  closed: false,
  myVotes: [] as string[],
  ...over,
});

describe('cleanPollDraft', () => {
  it('accepts 2 to 6 distinct options and ignores blank lines', () => {
    expect(cleanPollDraft({ question: ' Où ? ', options: ['Maquis', '', ' Pizza '], multiple: false })).toEqual({ ok: true, question: 'Où ?', options: ['Maquis', 'Pizza'] });
  });
  it('refuses duplicates, too few or too many options, long texts and an empty question', () => {
    expect(cleanPollDraft({ question: 'Q', options: ['oui', 'OUI'], multiple: false }).ok).toBe(false);
    expect(cleanPollDraft({ question: 'Q', options: ['seule'], multiple: false }).ok).toBe(false);
    expect(cleanPollDraft({ question: 'Q', options: ['1', '2', '3', '4', '5', '6', '7'], multiple: false }).ok).toBe(false);
    expect(cleanPollDraft({ question: 'Q', options: ['a', 'x'.repeat(81)], multiple: false }).ok).toBe(false);
    expect(cleanPollDraft({ question: 'q'.repeat(201), options: ['a', 'b'], multiple: false }).ok).toBe(false);
    expect(cleanPollDraft({ question: '  ', options: ['a', 'b'], multiple: false }).ok).toBe(false);
  });
});

describe('votes', () => {
  it('single choice replaces, multiple toggles, pressing again withdraws', () => {
    expect(nextVotes({ multiple: false }, ['a'], 'b')).toEqual(['b']);
    expect(nextVotes({ multiple: false }, ['a'], 'a')).toEqual([]);
    expect(nextVotes({ multiple: true }, ['a'], 'b')).toEqual(['a', 'b']);
    expect(nextVotes({ multiple: true }, ['a', 'b'], 'a')).toEqual(['b']);
  });
  it('computes percentages and totals', () => {
    expect(optionPercent(1, 3)).toBe(33);
    expect(optionPercent(0, 0)).toBe(0);
    expect(totalVotes(poll())).toBe(3);
  });
  it('withMyVotes moves a vote locally', () => {
    const p = withMyVotes(poll({ myVotes: ['a'] }), ['b']);
    expect(p.options.map((o) => o.votes)).toEqual([1, 2]);
    expect(p.voters).toBe(3);
    expect(p.myVotes).toEqual(['b']);
    const first = withMyVotes(poll(), ['a']);
    expect(first.voters).toBe(4);
    expect(withMyVotes(poll({ myVotes: ['a'] }), []).voters).toBe(2);
  });
});

describe('canClosePoll', () => {
  const m = { senderId: 'me', poll: poll() };
  it('the creator and group admins may close an open poll', () => {
    expect(canClosePoll(m, 'me', 'member')).toBe(true);
    expect(canClosePoll({ ...m, senderId: 'x' }, 'me', 'admin')).toBe(true);
    expect(canClosePoll({ ...m, senderId: 'x' }, 'me', 'owner')).toBe(true);
    expect(canClosePoll({ ...m, senderId: 'x' }, 'me', 'member')).toBe(false);
    expect(canClosePoll({ senderId: 'me', poll: poll({ closed: true }) }, 'me', 'owner')).toBe(false);
    expect(canClosePoll({ senderId: 'me', poll: null }, 'me', 'owner')).toBe(false);
  });
});

describe('applyPollEvent', () => {
  it('updates the counters and keeps my own votes', () => {
    const items = [
      { id: 'm1', poll: poll({ myVotes: ['a'] }) },
      { id: 'm2', poll: null },
    ];
    const ev = { messageId: 'm1', poll: poll({ voters: 5, closed: true, options: [{ id: 'a', label: 'A', votes: 4 }, { id: 'b', label: 'B', votes: 1 }] }) };
    const out = applyPollEvent(items, ev);
    expect(out[0]!.poll!.voters).toBe(5);
    expect(out[0]!.poll!.closed).toBe(true);
    expect(out[0]!.poll!.myVotes).toEqual(['a']);
    expect(out[1]).toBe(items[1]);
  });
});

describe('presence', () => {
  const base = { userId: 'u', visible: true, online: false, lastSeenAt: '2026-11-18T10:05:00.000Z' };
  it('maps the state to what the header shows', () => {
    expect(presenceView(undefined)).toEqual({ kind: 'hidden' });
    expect(presenceView({ ...base, visible: false })).toEqual({ kind: 'hidden' });
    expect(presenceView({ ...base, online: true })).toEqual({ kind: 'online' });
    expect(presenceView(base)).toEqual({ kind: 'lastSeen', at: new Date(base.lastSeenAt) });
    expect(presenceView({ ...base, lastSeenAt: null })).toEqual({ kind: 'unknown' });
  });
  it('says today, yesterday or a date', () => {
    const now = new Date(2026, 10, 18, 15, 0);
    expect(lastSeenWhen(new Date(2026, 10, 18, 9, 5), now, 'fr').day).toBe('today');
    expect(lastSeenWhen(new Date(2026, 10, 17, 23, 5), now, 'fr').day).toBe('yesterday');
    expect(lastSeenWhen(new Date(2026, 10, 10, 9, 5), now, 'fr').day).toBe('date');
  });
  it('ignores an event about someone else', () => {
    expect(applyPresence(base, { ...base, userId: 'other', online: true })).toBe(base);
    expect(applyPresence(base, { ...base, online: true }).online).toBe(true);
    expect(applyPresence(undefined, base)).toBe(base);
  });
});

describe('searchReady', () => {
  it('needs two useful characters', () => {
    expect(searchReady('a')).toBe(false);
    expect(searchReady(' a ')).toBe(false);
    expect(searchReady('ab')).toBe(true);
  });
});
