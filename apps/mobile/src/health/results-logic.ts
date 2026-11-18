import type { CreateHealthResultRequest, HealthResultKind, HealthShareKind } from '@caselind/contracts';
import { ApiRequestError } from '../lib/api';
import type { MessageKey } from '../i18n';
import { ENTRY_KINDS } from './logic';

export const RESULT_KINDS: HealthResultKind[] = ['blood', 'urine', 'imaging', 'other'];
export const resultKindKey = (k: HealthResultKind): MessageKey => `health.results.kind.${k}` as MessageKey;

/** Ce qu'un partage peut couvrir : les rubriques du dossier, plus les résultats d'examens. */
export const SHARE_KINDS: HealthShareKind[] = [...ENTRY_KINDS, 'results'];

/** Jour calendaire réel au format AAAA-MM-JJ (le 31 février est refusé). */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type ResultForm = { kind: HealthResultKind; title: string; summary: string; date: string; assetId?: string | null };

/** Valide le formulaire avant envoi ; la date ne peut pas être postérieure à aujourd'hui (le serveur reste la référence). */
export function buildResult(form: ResultForm, today: string): { ok: true; body: CreateHealthResultRequest } | { ok: false; error: MessageKey } {
  const title = form.title.trim();
  if (!title || title.length > 120) return { ok: false, error: 'health.results.err.title' };
  const date = form.date.trim();
  if (!isRealDate(date)) return { ok: false, error: 'health.results.err.date' };
  if (date > today) return { ok: false, error: 'health.results.err.future' };
  const summary = form.summary.trim();
  if (summary.length > 2000) return { ok: false, error: 'health.results.err.summary' };
  return { ok: true, body: { kind: form.kind, title, summary, resultDate: date, assetId: form.assetId ?? null } };
}

/** Message propre à ce module pour une erreur du serveur ; `null` pour laisser le message générique. */
export function resultErrorKey(err: unknown): MessageKey | null {
  if (!(err instanceof ApiRequestError)) return null;
  if (err.status === 403 && err.code === 'feature_disabled') return 'health.err.disabled';
  if (err.status === 409 && err.detail<string>('reason') === 'limit_reached') return 'health.results.err.limit';
  if (err.status === 400) return 'health.results.err.invalid';
  return null;
}
