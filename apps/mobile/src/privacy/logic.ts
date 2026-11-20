import { exportSectionLabels } from './messages';

/** Mots acceptés pour confirmer la suppression (français et anglais, sans tenir compte de la casse). */
const DELETION_WORDS = ['SUPPRIMER', 'DELETE'];

export const isDeletionWord = (input: string): boolean => DELETION_WORDS.includes(input.trim().toUpperCase());

/** La demande n'est possible qu'avec le mot de confirmation ET un mot de passe (l'API l'exige). */
export const canRequestDeletion = (word: string, password: string): boolean => isDeletionWord(word) && password.length > 0;

/** « orderReturns » -> « Order returns » : libellé de repli pour une rubrique sans traduction. */
export function humanizeKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function sectionLabel(key: string, locale: string): string {
  const labels: Record<string, string> = locale === 'fr' ? exportSectionLabels.fr : exportSectionLabels.en;
  return labels[key] ?? humanizeKey(key);
}

export interface ExportRow {
  key: string;
  count: number;
}

/** Une ligne par rubrique de l'export qui est une liste non vide, triées par libellé. */
export function summarizeExport(data: Record<string, unknown>, locale: string): { rows: ExportRow[]; total: number } {
  const rows = Object.entries(data)
    .filter((e): e is [string, unknown[]] => Array.isArray(e[1]) && e[1].length > 0)
    .map(([key, list]) => ({ key, count: list.length }))
    .sort((a, b) => sectionLabel(a.key, locale).localeCompare(sectionLabel(b.key, locale), locale));
  return { rows, total: rows.reduce((n, r) => n + r.count, 0) };
}

/** Le fichier complet, lisible. */
export const exportJson = (data: Record<string, unknown>): string => JSON.stringify(data, null, 2);
