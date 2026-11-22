import { describe, expect, it } from 'vitest';
import { formatDuration, isAudioMime, nextSpeed, recReduce, voiceMime, waveBars, type RecState } from './voice-logic';

describe('voice-logic', () => {
  it('formats durations', () => {
    expect([0, 7.9, 65, 300, -3, NaN].map(formatDuration)).toEqual(['0:00', '0:07', '1:05', '5:00', '0:00', '0:00']);
  });
  it('cycles speeds 1 -> 1.5 -> 2 -> 1', () => {
    expect([nextSpeed(1), nextSpeed(1.5), nextSpeed(2)]).toEqual([1.5, 2, 1]);
  });
  it('maps recorded types', () => {
    expect([voiceMime('audio/webm;codecs=opus'), voiceMime('video/mp4'), voiceMime(''), voiceMime('audio/ogg')]).toEqual(['audio/webm', 'audio/mp4', 'audio/mp4', 'audio/ogg']);
    expect(isAudioMime('audio/mp4') && !isAudioMime('application/pdf')).toBe(true);
  });
  it('builds a stable wave', () => {
    const w = waveBars('abc');
    expect(w).toEqual(waveBars('abc'));
    expect(w.every((x) => x >= 0.25 && x <= 1)).toBe(true);
  });
  it('state machine: hold and release sends, short tap locks, slide cancels, 5 min cap', () => {
    const held = recReduce({ phase: 'idle' }, { type: 'press', now: 0 }).state;
    expect(held).toEqual({ phase: 'holding', startedAt: 0 });
    expect(recReduce(held, { type: 'release', now: 4000 })).toEqual({ state: { phase: 'idle' }, effect: { do: 'send', seconds: 4 } });
    expect(recReduce(held, { type: 'release', now: 700 }).effect).toEqual({ do: 'discard' }); // trop court, mais pas un tap : jeté
    const locked = recReduce(held, { type: 'release', now: 200 }).state;
    expect(locked).toEqual({ phase: 'locked', startedAt: 0 });
    expect(recReduce(locked, { type: 'release', now: 9000 }).state).toEqual(locked);
    expect(recReduce(locked, { type: 'send', now: 12_000 }).effect).toEqual({ do: 'send', seconds: 12 });
    expect(recReduce(locked, { type: 'cancel' }).effect).toEqual({ do: 'discard' });
    expect(recReduce(held, { type: 'slide', dx: -30 }).state).toEqual(held);
    expect(recReduce(held, { type: 'slide', dx: -90 })).toEqual({ state: { phase: 'idle' }, effect: { do: 'discard' } });
    expect(recReduce(locked, { type: 'tick', now: 301_000 }).effect).toEqual({ do: 'send', seconds: 300 });
    const idle: RecState = { phase: 'idle' };
    expect(recReduce(idle, { type: 'send', now: 5 })).toEqual({ state: idle, effect: null });
  });
});
