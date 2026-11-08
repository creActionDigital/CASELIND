import type { AiModelCard, AiSettings } from '@caselind/contracts';
import { ApiRequestError } from '../lib/api';

/** Clés i18n des erreurs propres à l'assistant ; `null` = laisser le traducteur générique. */
export type AiErrorKey = 'ai.error.notice' | 'ai.error.unavailable' | 'ai.error.provider' | 'ai.error.quota';

export function aiErrorKey(err: unknown): AiErrorKey | null {
  if (!(err instanceof ApiRequestError)) return null;
  switch (err.code) {
    case 'data_notice_required':
      return 'ai.error.notice';
    case 'ai_unavailable':
      return 'ai.error.unavailable';
    case 'ai_provider_error':
      return 'ai.error.provider';
    case 'rate_limited':
      return 'ai.error.quota';
    default:
      return null;
  }
}

/** Le modèle choisi entraîne-t-il (ou peut-il entraîner) sur les données sans avertissement accepté ? */
export function needsDataNotice(card: Pick<AiModelCard, 'trainsOnData'> | undefined, settings: Pick<AiSettings, 'acknowledgedDataNotice'>): boolean {
  if (!card || settings.acknowledgedDataNotice) return false;
  return card.trainsOnData !== false;
}

/** Modèle effectif : celui de l'utilisateur s'il est encore disponible, sinon le modèle par défaut. */
export function effectiveModel(models: AiModelCard[], settings: Pick<AiSettings, 'modelId'>, defaultId: string | null): AiModelCard | undefined {
  return models.find((m) => m.id === settings.modelId) ?? models.find((m) => m.id === defaultId) ?? models[0];
}

/** Titre court d'une conversation à partir de la première question (une seule ligne, 60 caractères). */
export function titleFrom(question: string): string {
  const line = question.trim().split(/\s*\n\s*/)[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}
