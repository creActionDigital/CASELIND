import type { CourseLevel } from '@caselind/contracts';
import { ApiRequestError } from '../lib/api';
import type { MessageKey } from '../i18n';

export const COURSE_LEVELS: CourseLevel[] = ['beginner', 'intermediate', 'advanced'];
export const levelKey = (l: CourseLevel): MessageKey => `education.level.${l}` as MessageKey;

/** Réponses du quiz : une par question, dans l'ordre ; `null` tant qu'une question n'a pas de réponse. */
export function completeAnswers(answers: (number | undefined)[], total: number): number[] | null {
  if (answers.length < total) return null;
  const out = answers.slice(0, total);
  return out.every((a): a is number => typeof a === 'number') ? out : null;
}

/** Lignes d'options saisies dans un champ multiligne (une par ligne, vides ignorées). */
export const parseOptions = (text: string): string[] => text.split('\n').map((s) => s.trim()).filter(Boolean);

/** « Bonne réponse n° » (1-based) vers l'index serveur ; `null` si hors limites. */
export function correctIndex(input: string, optionCount: number): number | null {
  const n = Number(input.trim());
  return Number.isInteger(n) && n >= 1 && n <= optionCount ? n - 1 : null;
}

export function educationErrorKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiRequestError)) return null;
  const reason = err.detail<string>('reason');
  if (reason === 'course_has_learners') return 'education.err.has_learners';
  if (reason === 'course_empty') return 'education.err.empty';
  if (reason === 'exam_not_enabled' || reason === 'no_quiz' || reason === 'daily_limit' || reason === 'expired' || reason === 'already_finished') return `education.err.${reason}` as MessageKey;
  return null;
}

/** Compte à rebours « m:ss » ; 0 une fois l'échéance passée. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
