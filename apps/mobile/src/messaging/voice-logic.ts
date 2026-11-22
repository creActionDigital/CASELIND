import { VOICE_MAX_SECONDS, type MediaMime } from '@caselind/contracts';

export { VOICE_MAX_SECONDS };
/** Un appui plus court que ça verrouille l'enregistrement ; plus long = on maintient. */
export const TAP_MS = 350;
/** Glisser d'au moins ce nombre de pixels vers la gauche annule. */
export const CANCEL_DX = 80;
/** Sous cette durée (secondes), le vocal est jeté (appui accidentel). */
export const MIN_SECONDS = 1;
export const SPEEDS = [1, 1.5, 2] as const;

/** 0:07, 1:05 ; arrondi à la seconde inférieure. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const nextSpeed = (rate: number): number => SPEEDS[(SPEEDS.indexOf(rate as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!;
export const speedLabel = (rate: number): string => `${String(rate).replace('.', ',')}x`;

export type RecState = { phase: 'idle' } | { phase: 'holding'; startedAt: number } | { phase: 'locked'; startedAt: number };
export type RecEvent =
  | { type: 'press'; now: number }
  | { type: 'release'; now: number }
  | { type: 'slide'; dx: number }
  | { type: 'cancel' }
  | { type: 'send'; now: number }
  | { type: 'tick'; now: number };
/** Effet demandé à l'écran : envoyer l'enregistrement (durée en secondes) ou le jeter. */
export type RecEffect = { do: 'send'; seconds: number } | { do: 'discard' } | null;

const secondsSince = (start: number, now: number) => Math.min(VOICE_MAX_SECONDS, Math.max(0, (now - start) / 1000));
const finish = (start: number, now: number): { state: RecState; effect: RecEffect } => {
  const seconds = secondsSince(start, now);
  return { state: { phase: 'idle' }, effect: seconds >= MIN_SECONDS ? { do: 'send', seconds: Math.round(seconds) } : { do: 'discard' } };
};

/** Machine d'état de l'enregistrement : maintenir, toucher pour verrouiller, glisser pour annuler, limite de 5 minutes. */
export function recReduce(s: RecState, e: RecEvent): { state: RecState; effect: RecEffect } {
  const same = { state: s, effect: null };
  if (s.phase === 'idle') return e.type === 'press' ? { state: { phase: 'holding', startedAt: e.now }, effect: null } : same;
  if (e.type === 'cancel') return { state: { phase: 'idle' }, effect: { do: 'discard' } };
  if (e.type === 'tick') return secondsSince(s.startedAt, e.now) >= VOICE_MAX_SECONDS ? finish(s.startedAt, e.now) : same;
  if (s.phase === 'holding') {
    if (e.type === 'slide') return e.dx <= -CANCEL_DX ? { state: { phase: 'idle' }, effect: { do: 'discard' } } : same;
    if (e.type === 'release') return e.now - s.startedAt < TAP_MS ? { state: { phase: 'locked', startedAt: s.startedAt }, effect: null } : finish(s.startedAt, e.now);
    return same;
  }
  return e.type === 'send' ? finish(s.startedAt, e.now) : same;
}

/** Type envoyé à l'API d'après le type du fichier enregistré (le web donne webm ou mp4, le natif m4a). */
export function voiceMime(recorded: string | null | undefined): MediaMime {
  const t = (recorded ?? '').toLowerCase();
  if (t.startsWith('audio/webm') || t.startsWith('video/webm')) return 'audio/webm';
  if (t.startsWith('audio/ogg')) return 'audio/ogg';
  if (t.startsWith('audio/mpeg')) return 'audio/mpeg';
  return 'audio/mp4';
}

/** Hauteurs (0.25 à 1) d'une onde stable pour un message donné, dérivées de son id. */
export function waveBars(seed: string, count = 28): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: count }, () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) + 1;
    return 0.25 + ((h >>> 0) % 1000) / 1333;
  });
}

export const isAudioMime = (mime: string | null | undefined): boolean => !!mime && mime.startsWith('audio/');
