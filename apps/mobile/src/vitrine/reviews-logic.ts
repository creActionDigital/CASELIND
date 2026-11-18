import { ORG_ANSWER_MAX, ORG_QUESTION_MAX, type OrgRating, STORE_REVIEW_BODY_MAX, STORE_REVIEW_REPLY_MAX, type SaveStoreReviewRequest } from '@caselind/contracts';

/** Formulaire d'avis → requête (mêmes règles que l'API) ; sinon le champ fautif. Texte vide = note seule (`null`, pour effacer le texte). */
export function buildReview(rating: number, text: string): { ok: SaveStoreReviewRequest } | { error: 'rating' | 'body' } {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'rating' };
  const body = text.trim();
  if (body.length > STORE_REVIEW_BODY_MAX) return { error: 'body' };
  return { ok: { rating, body: body || null } };
}

/** Texte d'une question, d'une réponse ou d'une réponse à un avis, nettoyé ; `null` si vide ou trop long. */
function clean(text: string, max: number): string | null {
  const v = text.trim();
  return v && v.length <= max ? v : null;
}
export const cleanQuestion = (text: string) => clean(text, ORG_QUESTION_MAX);
export const cleanAnswer = (text: string) => clean(text, ORG_ANSWER_MAX);
export const cleanReviewReply = (text: string) => clean(text, STORE_REVIEW_REPLY_MAX);

/** « 4,5 » (français) ou « 4.5 » : une décimale, pour la note moyenne. */
export function formatAverage(average: number, locale: string): string {
  const s = (Math.round(average * 10) / 10).toFixed(1);
  return locale.startsWith('en') ? s : s.replace('.', ',');
}

export const ratingLabel = (r: OrgRating, locale: string) => `${formatAverage(r.average, locale)} (${r.count})`;

export type FeedbackError = 'notPurchased' | 'member' | 'moderated' | 'rateLimited' | 'unavailable';

/** Réponse d'erreur de l'API (statut + `details.reason`) → motif connu, sinon `null` (message générique). */
export function feedbackError(status: number, reason: string | undefined): FeedbackError | null {
  if (status === 403 && reason === 'not_purchased') return 'notPurchased';
  if (status === 403 && reason === 'member') return 'member';
  if (status === 409 && reason === 'moderated') return 'moderated';
  if (status === 409 && reason === 'rate_limited') return 'rateLimited';
  if (status === 404) return 'unavailable';
  return null;
}
