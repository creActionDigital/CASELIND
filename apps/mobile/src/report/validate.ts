import { REPORT_DETAILS_MAX, reportReasonSchema, type ReportReason } from '@caselind/contracts';
import { ApiRequestError } from '../lib/api';

export const REPORT_REASONS = reportReasonSchema.options as readonly ReportReason[];

export type ReportFormError = 'reason' | 'details';

/** Valide le formulaire : motif obligatoire, détails ≤ 1000 caractères (après trim). */
export function validateReport(input: { reason: ReportReason | null; details: string }): ReportFormError | null {
  if (!input.reason || !REPORT_REASONS.includes(input.reason)) return 'reason';
  if (input.details.trim().length > REPORT_DETAILS_MAX) return 'details';
  return null;
}

/** Corps de la requête : `details` omis s'il est vide. */
export function buildDetails(details: string): string | undefined {
  const d = details.trim();
  return d.length > 0 ? d : undefined;
}

/** Clé i18n pour les erreurs propres aux signalements, ou null (message générique). */
export function reportErrorKey(err: unknown): 'report.error.unavailable' | 'report.error.already' | 'report.error.rate' | null {
  if (!(err instanceof ApiRequestError)) return null;
  if (err.status === 404) return 'report.error.unavailable';
  if (err.status === 409) return 'report.error.already';
  if (err.status === 429) return 'report.error.rate';
  return null;
}
