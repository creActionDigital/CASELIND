import { ApiRequestError } from '../lib/api';
import type { MessageKey } from '../i18n';

/** Secondes restantes avant `expiresAt` (jamais négatif). */
export const secondsLeft = (expiresAt: string, now = Date.now()): number => Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));

/** « 1:05 » pour 65 secondes. */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Une réponse par question, dans l'ordre ; `null` tant qu'il en manque. */
export function completeAnswers(answers: (number | undefined)[], total: number): number[] | null {
  const out = answers.slice(0, total);
  return out.length === total && out.every((a): a is number => typeof a === 'number') ? out : null;
}

export function gameErrorKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiRequestError)) return null;
  const map: Record<string, MessageKey> = {
    not_enough_questions: 'games.err.not_enough',
    daily_limit: 'games.err.daily_limit',
    expired: 'games.err.expired',
    already_finished: 'games.err.finished',
    cooldown: 'games.err.cooldown',
  };
  const reason = err.detail<string>('reason');
  return reason && map[reason] ? map[reason]! : null;
}
